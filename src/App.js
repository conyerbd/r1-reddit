import React, { useState, useEffect, useRef } from 'react';
import './App.css';

function App() {
  const [currentView, setCurrentView] = useState('main'); // 'main', 'feed', or 'post'
  const [currentFeed, setCurrentFeed] = useState(null); // e.g., 'popular', 'all', 'technology'
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [currentPost, setCurrentPost] = useState(null);
  const [postContent, setPostContent] = useState(null);
  const [postLoading, setPostLoading] = useState(false);
  const postsContainerRef = useRef(null);
  const lastScrollTimeRef = useRef(Date.now());

  // Function to get RSS URL based on feed type
  const getRSSUrl = (feedType) => {
    switch (feedType) {
      case 'home':
        return 'https://www.reddit.com/.rss?geo_filter=GLOBAL';
      case 'popular':
        return 'https://www.reddit.com/r/popular/.rss?geo_filter=GLOBAL';
      case 'all':
        return 'https://www.reddit.com/r/all/.rss?geo_filter=GLOBAL';
      default:
        return `https://www.reddit.com/r/${feedType}/.rss?geo_filter=GLOBAL`;
    }
  };
  
  const fetchRedditRSS = async (feedType) => {
    try {
      console.log('Starting RSS fetch for:', feedType);
      setLoading(true);
      setError(null);
      setPosts([]);

      const rssUrl = getRSSUrl(feedType);
      const proxies = [
        `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(rssUrl)}`,
        `https://corsproxy.io/?${encodeURIComponent(rssUrl)}`,
        `https://api.allorigins.win/raw?url=${encodeURIComponent(rssUrl)}`,
        rssUrl
      ];

      let xmlContent = null;
      for (const proxyUrl of proxies) {
        try {
          const response = await fetch(proxyUrl);
          if (response.ok) {
            const text = await response.text();
            if (text.includes('<?xml')) {
              xmlContent = text;
              break;
            }
          }
        } catch (proxyErr) {
          console.log('Proxy failed:', proxyUrl, proxyErr.message);
        }
      }

      if (!xmlContent) {
        throw new Error('All proxy attempts failed');
      }

      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlContent, 'text/xml');
      const parserError = xmlDoc.querySelector('parsererror');
      if (parserError) {
        throw new Error(`XML parsing failed: ${parserError.textContent}`);
      }

      const entries = xmlDoc.querySelectorAll('entry');
      if (entries.length > 0) {
        const parsedPosts = Array.from(entries).slice(0, 20).map((entry, index) => {
          const titleElement = entry.querySelector('title');
          const linkElement = entry.querySelector('link');
          const contentElement = entry.querySelector('content');
          const authorElement = entry.querySelector('author name');
          const updatedElement = entry.querySelector('updated');
          const idElement = entry.querySelector('id');

          const title = titleElement?.textContent || `Post ${index + 1}`;
          const link = linkElement?.getAttribute('href') || linkElement?.textContent || '';
          const content = contentElement?.textContent || '';
          const author = authorElement?.textContent?.replace('/u/', '') || 'Unknown';
          const updated = updatedElement?.textContent || new Date().toISOString();
          const id = idElement?.textContent || `post-${index}`;
          const rssLink = link.includes('/comments/') ? link + '.rss' : link;
          
          // Extract actual subreddit from the link (format: /r/SubredditName/)
          const subredditMatch = link.match(/\/r\/([^/]+)\//);
          const actualSubreddit = subredditMatch ? subredditMatch[1] : feedType;

          return { title, link: rssLink, content, author, updated, subreddit: actualSubreddit, id };
        }).filter(post => {
          // Filter out image, gallery, and video posts
          const isImagePost = post.link.includes('i.redd.it') || 
                             post.link.includes('i.imgur.com') ||
                             post.link.includes('/gallery/') ||
                             post.link.includes('gallery.reddit.com');
          
          const isVideoPost = post.link.includes('v.redd.it') ||
                             post.link.includes('youtube.com') ||
                             post.link.includes('youtu.be') ||
                             post.link.includes('vimeo.com') ||
                             post.link.includes('streamable.com');
          
          // Also check if content is just an image tag with minimal text
          const hasOnlyImage = post.content && 
                              post.content.includes('<img') && 
                              post.content.replace(/<[^>]*>/g, '').trim().length < 50;
          
          return !isImagePost && !isVideoPost && !hasOnlyImage;
        });
        setPosts(parsedPosts);
      } else {
        throw new Error('No entries found in RSS feed');
      }
    } catch (err) {
      console.error('Error fetching Reddit RSS:', err);
      setError(`Failed to fetch posts: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };
  
  useEffect(() => {
    if (currentFeed) {
      fetchRedditRSS(currentFeed);
    }
  }, [currentFeed]);

  // Function to fetch and display individual post RSS content
  const fetchPostContent = async (postUrl, postTitle, subreddit) => {
    setPostLoading(true);
    setCurrentView('post');
    setCurrentPost({ title: postTitle, url: postUrl, subreddit: subreddit });
    
    try {
      console.log('Fetching post RSS:', postUrl);
      
      // Try multiple proxy services for the RSS content
      const proxies = [
        `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(postUrl)}`,
        `https://corsproxy.io/?${encodeURIComponent(postUrl)}`,
        `https://api.allorigins.win/raw?url=${encodeURIComponent(postUrl)}`,
        postUrl
      ];
      
      let xmlContent = null;
      
      for (const proxyUrl of proxies) {
        try {
          console.log('Trying proxy for post:', proxyUrl);
          const response = await fetch(proxyUrl);
          
          if (response.ok) {
            const text = await response.text();
            if (text.includes('<?xml')) {
              xmlContent = text;
              break;
            }
          }
        } catch (proxyErr) {
          console.log('Post proxy failed:', proxyUrl, proxyErr.message);
          continue;
        }
      }
      
      if (!xmlContent) {
        throw new Error('Failed to fetch post content');
      }
      
      // Parse the post RSS XML
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlContent, 'text/xml');
      const entries = xmlDoc.querySelectorAll('entry');
      
      if (entries.length > 0) {
        // Parse all entries from the RSS feed
        const allEntries = Array.from(entries).map((entry, index) => {
          const title = entry.querySelector('title')?.textContent || '';
          const content = entry.querySelector('content')?.textContent || '';
          const author = entry.querySelector('author name')?.textContent?.replace('/u/', '') || 'Unknown';
          const updated = entry.querySelector('updated')?.textContent || '';
          const id = entry.querySelector('id')?.textContent || `entry-${index}`;
          const link = entry.querySelector('link')?.getAttribute('href') || '';
          const isMainPost = index === 0; // First entry is usually the main post
          
          // Determine if this is a top-level comment by analyzing URL structure
          let isTopLevel = false;
          
          if (isMainPost) {
            isTopLevel = false; // Main post is not a comment
          } else if (link) {
            // Reddit comment URL structure:
            // Top-level: /r/sub/comments/postid/_/commentid
            // Nested: /r/sub/comments/postid/_/commentid/nestedid (or more levels)
            
            // Extract the part after /comments/
            const commentsMatch = link.match(/\/comments\/[^/]+\/_\/(.+?)(?:[?#]|$)/);
            if (commentsMatch) {
              const pathAfterUnderscore = commentsMatch[1];
              // Remove trailing slash and split by /
              const segments = pathAfterUnderscore.replace(/\/$/, '').split('/').filter(s => s.length > 0);
              // Top-level comments have exactly 1 segment (just the comment ID)
              isTopLevel = segments.length === 1;
              
              // Debug logging
              console.log(`Comment ${index}: segments=${segments.length}, isTopLevel=${isTopLevel}, path=${pathAfterUnderscore}`);
            } else {
              // If we can't parse the URL, assume it's top-level to be safe
              console.log(`Comment ${index}: Could not parse URL, assuming top-level. Link: ${link}`);
              isTopLevel = true;
            }
          }
          
          return {
            title,
            content,
            author,
            updated,
            isMainPost,
            isTopLevel,
            id,
            link
          };
        });
        
        // Get main post and up to 10 top-level comments
        const mainPost = allEntries[0];
        const topLevelComments = allEntries.slice(1).filter(entry => entry.isTopLevel).slice(0, 10);
        const filteredEntries = [mainPost, ...topLevelComments];
        
        console.log(`Total entries: ${allEntries.length}, Top-level comments found: ${topLevelComments.length}, Showing: ${filteredEntries.length}`);
        
        const postData = {
          title: xmlDoc.querySelector('title')?.textContent || postTitle,
          entries: filteredEntries
        };
        
        setPostContent(postData);
      } else {
        throw new Error('No content found in post RSS');
      }
      
    } catch (err) {
      console.error('Error fetching post content:', err);
      setPostContent({
        title: postTitle,
        error: `Failed to load post content: ${err.message}`
      });
    }
    
    setPostLoading(false);
  };

  // Function to go back to the main feed
  const goBackToFeed = () => {
    setCurrentView('feed');
    setCurrentPost(null);
    setPostContent(null);
  };

  const selectFeed = (feedType) => {
    setCurrentFeed(feedType);
    setCurrentView('feed');
  };

  // Scroll wheel and keyboard functionality for Rabbit R1 device
  useEffect(() => {
    const scrollContainer = (direction) => {
      if (postsContainerRef.current) {
        const container = postsContainerRef.current;
        
        // Calculate velocity-based scroll amount
        const now = Date.now();
        const timeDelta = now - lastScrollTimeRef.current;
        lastScrollTimeRef.current = now;
        
        // Determine scroll amount based on velocity
        // Fast scrolling (< 100ms between events) = larger jumps (30-40px)
        // Medium scrolling (100-300ms) = medium jumps (20-30px)
        // Slow scrolling (> 300ms) = small jumps (10-20px)
        let scrollAmount;
        if (timeDelta < 100) {
          scrollAmount = 35; // Fast
        } else if (timeDelta < 300) {
          scrollAmount = 22; // Medium
        } else {
          scrollAmount = 12; // Slow/deliberate
        }
        
        container.scrollBy({
          top: direction * scrollAmount,
          behavior: 'smooth'
        });
      }
    };

    // R1 scroll wheel events: directions are flipped!
    // "scrollUp" = wheel turns up = moves content DOWN (increase scrollTop)
    // "scrollDown" = wheel turns down = moves content UP (decrease scrollTop)
    const handleScrollDown = (event) => {
      event.preventDefault();
      scrollContainer(-1); // scrollDown event = moves content UP
    };

    const handleScrollUp = (event) => {
      event.preventDefault();
      scrollContainer(1); // scrollUp event = moves content DOWN
    };

    const handleKeyDown = (event) => {
      // Handle arrow keys for additional navigation support
      switch (event.key) {
        case 'ArrowUp':
          event.preventDefault();
          scrollContainer(-1);
          break;
        case 'ArrowDown':
          event.preventDefault();
          scrollContainer(1);
          break;
        default:
          break;
      }
    };

    // Add R1 scroll wheel event listeners
    window.addEventListener('scrollDown', handleScrollDown, { passive: false, capture: true });
    window.addEventListener('scrollUp', handleScrollUp, { passive: false, capture: true });
    document.addEventListener('scrollDown', handleScrollDown, { passive: false, capture: true });
    document.addEventListener('scrollUp', handleScrollUp, { passive: false, capture: true });
    
    // Add keyboard listener
    document.addEventListener('keydown', handleKeyDown);

    // Cleanup event listeners on component unmount
    return () => {
      window.removeEventListener('scrollDown', handleScrollDown, { capture: true });
      window.removeEventListener('scrollUp', handleScrollUp, { capture: true });
      document.removeEventListener('scrollDown', handleScrollDown, { capture: true });
      document.removeEventListener('scrollUp', handleScrollUp, { capture: true });
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [loading, currentView]); // Re-run when loading state or view changes

  // Helper function to format time ago
  const timeAgo = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInHours = Math.floor((now - date) / (1000 * 60 * 60));
    
    if (diffInHours < 1) return 'now';
    if (diffInHours < 24) return `${diffInHours}h`;
    const diffInDays = Math.floor(diffInHours / 24);
    return `${diffInDays}d`;
  };

  // Helper function to clean HTML content for display
  const cleanHtmlContent = (htmlContent) => {
    if (!htmlContent) return '';
    
    // Create a temporary div to parse HTML
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = htmlContent;
    
    // Get text content and clean it up
    let text = tempDiv.textContent || tempDiv.innerText || '';
    
    // Remove Reddit-specific markup
    text = text.replace(/<!-- SC_OFF -->|<!-- SC_ON -->/g, '');
    text = text.replace(/^\s+|\s+$/g, ''); // Trim whitespace
    
    return text;
  };

  // Helper function to remove subreddit name from post title
  const cleanPostTitle = (title) => {
    if (!title) return '';
    
    // Remove subreddit suffix (formats: " : SubredditName" or " - SubredditName")
    // Match pattern: " : text" or " - text" at the end of the title
    const cleaned = title.replace(/\s+[:|-]\s+[A-Za-z0-9_]+\s*$/, '');
    
    return cleaned;
  };


  if (currentView === 'main') {
    return (
      <div className="viewport">
        <div className="App main-menu">
          <div className="home-hero">
            <div className="reddit-logo">
              <div className="reddit-icon">r/</div>
              <h1 className="home-title">reddit</h1>
            </div>
            <p className="home-subtitle">for Rabbit R1</p>
          </div>
          <main className="main-menu-container">
            <button className="main-menu-button home-button" onClick={() => selectFeed('home')}>
              <span className="button-icon">🏠</span>
              <span className="button-content">
                <span className="button-title">Home</span>
                <span className="button-desc">Your feed</span>
              </span>
            </button>
            <button className="main-menu-button popular-button" onClick={() => selectFeed('popular')}>
              <span className="button-icon">🔥</span>
              <span className="button-content">
                <span className="button-title">Popular</span>
                <span className="button-desc">Trending posts</span>
              </span>
            </button>
            <button className="main-menu-button all-button" onClick={() => selectFeed('all')}>
              <span className="button-icon">🌐</span>
              <span className="button-content">
                <span className="button-title">All</span>
                <span className="button-desc">Everything</span>
              </span>
            </button>
          </main>
        </div>
      </div>
    );
  }

  if (currentView === 'feed') {
    if (loading) {
      return (
        <div className="viewport">
          <div className="App">
            <header className="app-header">
              <h1>r/{currentFeed}</h1>
              <p className="last-updated">Loading...</p>
            </header>
            <div className="loading">loading r/{currentFeed} posts...</div>
          </div>
        </div>
      );
    }

    if (error) {
      return (
        <div className="viewport">
          <div className="App">
            <header className="app-header">
              <h1>r/{currentFeed}</h1>
              <p className="last-updated">Error</p>
            </header>
            <div className="error">
              <p>{error}</p>
              <button onClick={() => fetchRedditRSS(currentFeed)} style={{
                marginTop: '10px',
                padding: '8px 16px',
                background: '#ff4500',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
              }}>
                Try Again
              </button>
            </div>
          </div>
        </div>
      );
    }
    
    return (
      <div className="viewport">
        <div className="App">
          <header className="app-header">
            <h1>r/{currentFeed}</h1>
            <button className="back-button" onClick={() => setCurrentView('main')}>←</button>
          </header>
          <main className="posts-container" ref={postsContainerRef}>
            {posts.map((post, index) => (
              <article key={post.id || index} className="post-card">
                <h2 className="post-title">
                  <button 
                    className="post-link" 
                    onClick={() => fetchPostContent(post.link, post.title, post.subreddit)}
                  >
                    {post.title}
                  </button>
                </h2>
                <div className="post-meta">
                  <span className="post-author">u/{post.author}</span>
                  <span className="post-date">{timeAgo(post.updated)}</span>
                </div>
              </article>
            ))}
          </main>
        </div>
      </div>
    );
  }

  // Render post view
  if (currentView === 'post') {
    return (
      <div className="viewport">
        <div className="App">
          <header className="post-header">
            <h1 className="post-subreddit">r/{currentPost?.subreddit || 'reddit'}</h1>
            <button className="back-button" onClick={goBackToFeed}>←</button>
          </header>
          <main className="post-content-container" ref={postsContainerRef}>
            {postLoading ? (
              <div className="loading">Loading post...</div>
            ) : postContent?.error ? (
              <div className="error">{postContent.error}</div>
            ) : postContent ? (
              <div className="post-content">
                <h2 className="main-post-title">{cleanPostTitle(postContent.title)}</h2>
                {postContent.entries?.map((entry, index) => {
                  // Skip the main post if it only contains "submitted by" info
                  if (entry.isMainPost) {
                    const content = cleanHtmlContent(entry.content);
                    // Only show main post content if it has substantial content beyond submission info
                    if (content && content.length > 100 && !content.toLowerCase().includes('submitted by')) {
                      return (
                        <div key={entry.id} className="content-entry main-post">
                          <div className="entry-content">
                            {content}
                          </div>
                        </div>
                      );
                    }
                    return null; // Skip main post if it's just submission info
                  }
                  
                  // Show comments
                  return (
                    <div key={entry.id} className="content-entry comment">
                      <div className="comment-header">
                        <span className="comment-author">u/{entry.author}</span>
                        <span className="comment-time">{timeAgo(entry.updated)}</span>
                      </div>
                      <div className="entry-content">
                        {cleanHtmlContent(entry.content)}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </main>
        </div>
      </div>
    );
  }
}

export default App;
