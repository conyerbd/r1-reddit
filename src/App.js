import React, { useState, useEffect, useRef } from 'react';
import './App.css';

function App() {
  const [currentView, setCurrentView] = useState('main'); // 'main', 'feed', or 'post'
  const [currentFeed, setCurrentFeed] = useState(null); // e.g., 'popular', 'all', 'technology'
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [currentPost, setCurrentPost] = useState(null);
  const [postContent, setPostContent] = useState(null);
  const [postLoading, setPostLoading] = useState(false);
  const postsContainerRef = useRef(null);
  const [customSubreddit, setCustomSubreddit] = useState('');
  const [lastPostId, setLastPostId] = useState(null); // For pagination
  
  // Smooth scrolling state
  const scrollVelocityRef = useRef(0);
  const scrollDirectionRef = useRef(0);
  const lastTickTimeRef = useRef(Date.now());
  const animationFrameRef = useRef(null);
  const scrollBufferRef = useRef([]);

  // Function to get RSS URL based on feed type
  const getRSSUrl = (feedType, after = null) => {
    const afterParam = after ? `&after=${after}` : '';
    switch (feedType) {
      case 'home':
        return `https://www.reddit.com/.rss?geo_filter=GLOBAL&limit=100${afterParam}`;
      case 'popular':
        return `https://www.reddit.com/r/popular/.rss?geo_filter=GLOBAL&limit=100${afterParam}`;
      case 'all':
        return `https://www.reddit.com/r/all/.rss?geo_filter=GLOBAL&limit=100${afterParam}`;
      default:
        return `https://www.reddit.com/r/${feedType}/.rss?geo_filter=GLOBAL&limit=100${afterParam}`;
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
        // Process all 100 entries from RSS feed, filter, then take first 20
        const parsedPosts = Array.from(entries).map((entry, index) => {
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
          const jsonLink = link.includes('/comments/') ? link + '.json' : link;
          
          // Extract actual subreddit from the link (format: /r/SubredditName/)
          const subredditMatch = link.match(/\/r\/([^/]+)\//);
          const actualSubreddit = subredditMatch ? subredditMatch[1] : feedType;

          return { title, link: jsonLink, content, author, updated, subreddit: actualSubreddit, id };
        }).filter(post => {
          // Check both the link and the content for media indicators
          const combinedText = post.link + ' ' + (post.content || '');
          
          // Filter out image posts
          const isImagePost = combinedText.includes('i.redd.it') || 
                             combinedText.includes('i.imgur.com') ||
                             combinedText.includes('preview.redd.it') ||
                             combinedText.includes('/gallery/') ||
                             combinedText.includes('gallery.reddit.com') ||
                             combinedText.includes('.jpg') ||
                             combinedText.includes('.jpeg') ||
                             combinedText.includes('.png') ||
                             combinedText.includes('.gif');
          
          // Filter out video posts
          const isVideoPost = combinedText.includes('v.redd.it') ||
                             combinedText.includes('youtube.com') ||
                             combinedText.includes('youtu.be') ||
                             combinedText.includes('vimeo.com') ||
                             combinedText.includes('streamable.com') ||
                             combinedText.includes('external-preview.redd.it');
          
          // Check if content has an image tag but minimal text content
          const hasOnlyImage = post.content && 
                              post.content.includes('<img') && 
                              post.content.replace(/<[^>]*>/g, '').trim().length < 100;
          
          // Also filter out posts from image-focused subreddits
          const imageSubreddits = ['pics', 'images', 'itookapicture', 'earthporn', 'memes', 
                                   'dankmemes', 'meirl', 'me_irl', 'comics', 'gifs'];
          const isImageSubreddit = imageSubreddits.some(sub => 
            post.subreddit.toLowerCase() === sub.toLowerCase()
          );
          
          return !isImagePost && !isVideoPost && !hasOnlyImage && !isImageSubreddit;
        }).slice(0, 20); // Take first 20 posts after filtering
        
        setPosts(parsedPosts);
        
        // Store the last post ID for pagination
        if (parsedPosts.length > 0) {
          const lastId = parsedPosts[parsedPosts.length - 1].id;
          setLastPostId(lastId);
        }
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
  
  const loadMorePosts = async () => {
    if (!currentFeed || !lastPostId || loadingMore) return;
    
    try {
      console.log('Loading more posts after:', lastPostId);
      setLoadingMore(true);
      setError(null);

      const rssUrl = getRSSUrl(currentFeed, lastPostId);
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
        const parsedPosts = Array.from(entries).map((entry, index) => {
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
          const jsonLink = link.includes('/comments/') ? link + '.json' : link;
          
          const subredditMatch = link.match(/\/r\/([^/]+)\//);
          const actualSubreddit = subredditMatch ? subredditMatch[1] : currentFeed;

          return { title, link: jsonLink, content, author, updated, subreddit: actualSubreddit, id };
        }).filter(post => {
          const combinedText = post.link + ' ' + (post.content || '');
          
          const isImagePost = combinedText.includes('i.redd.it') || 
                             combinedText.includes('i.imgur.com') ||
                             combinedText.includes('preview.redd.it') ||
                             combinedText.includes('/gallery/') ||
                             combinedText.includes('gallery.reddit.com') ||
                             combinedText.includes('.jpg') ||
                             combinedText.includes('.jpeg') ||
                             combinedText.includes('.png') ||
                             combinedText.includes('.gif');
          
          const isVideoPost = combinedText.includes('v.redd.it') ||
                             combinedText.includes('youtube.com') ||
                             combinedText.includes('youtu.be') ||
                             combinedText.includes('vimeo.com') ||
                             combinedText.includes('streamable.com') ||
                             combinedText.includes('external-preview.redd.it');
          
          const hasOnlyImage = post.content && 
                              post.content.includes('<img') && 
                              post.content.replace(/<[^>]*>/g, '').trim().length < 100;
          
          const imageSubreddits = ['pics', 'images', 'itookapicture', 'earthporn', 'memes', 
                                   'dankmemes', 'meirl', 'me_irl', 'comics', 'gifs'];
          const isImageSubreddit = imageSubreddits.some(sub => 
            post.subreddit.toLowerCase() === sub.toLowerCase()
          );
          
          return !isImagePost && !isVideoPost && !hasOnlyImage && !isImageSubreddit;
        }).slice(0, 20);
        
        // Append new posts to existing ones
        setPosts(prevPosts => [...prevPosts, ...parsedPosts]);
        
        // Update last post ID for next pagination
        if (parsedPosts.length > 0) {
          const lastId = parsedPosts[parsedPosts.length - 1].id;
          setLastPostId(lastId);
        }
      }
    } catch (err) {
      console.error('Error loading more posts:', err);
      setError(`Failed to load more posts: ${err.message}`);
    } finally {
      setLoadingMore(false);
    }
  };
  
  useEffect(() => {
    if (currentFeed) {
      fetchRedditRSS(currentFeed);
    }
  }, [currentFeed]);

  // Function to fetch and display individual post JSON content
  const fetchPostContent = async (postUrl, postTitle, subreddit) => {
    setPostLoading(true);
    setCurrentView('post');
    setCurrentPost({ title: postTitle, url: postUrl, subreddit: subreddit });
    
    try {
      console.log('Fetching post JSON:', postUrl);
      
      // Try multiple proxy services for the JSON content
      const proxies = [
        `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(postUrl)}`,
        `https://corsproxy.io/?${encodeURIComponent(postUrl)}`,
        `https://api.allorigins.win/raw?url=${encodeURIComponent(postUrl)}`,
        postUrl
      ];
      
      let jsonData = null;
      
      for (const proxyUrl of proxies) {
        try {
          console.log('Trying proxy for post:', proxyUrl);
          const response = await fetch(proxyUrl);
          
          if (response.ok) {
            const text = await response.text();
            try {
              const parsed = JSON.parse(text);
              if (Array.isArray(parsed) && parsed.length >= 2) {
                jsonData = parsed;
                break;
              }
            } catch (parseErr) {
              console.log('JSON parse failed for proxy:', proxyUrl);
            }
          }
        } catch (proxyErr) {
          console.log('Post proxy failed:', proxyUrl, proxyErr.message);
          continue;
        }
      }
      
      if (!jsonData) {
        throw new Error('Failed to fetch post content');
      }
      
      // Parse Reddit JSON structure
      // jsonData[0] = post data
      // jsonData[1] = comments data
      const postData = jsonData[0].data.children[0].data;
      const commentsData = jsonData[1].data.children;
      
      // Extract main post info
      const mainPost = {
        title: postData.title,
        content: postData.selftext || '',
        author: postData.author,
        updated: new Date(postData.created_utc * 1000).toISOString(),
        isMainPost: true,
        id: postData.id
      };
      
      // Helper function to recursively collect comments
      const collectComments = (comment, postId) => {
        if (!comment.data || comment.kind === 'more') {
          return null; // Skip "load more" placeholders
        }
        
        const data = comment.data;
        const isTopLevel = data.parent_id === `t3_${postId}`; // t3_ prefix means parent is a post
        
        return {
          content: data.body || '',
          author: data.author,
          updated: new Date(data.created_utc * 1000).toISOString(),
          isMainPost: false,
          isTopLevel: isTopLevel,
          id: data.id
        };
      };
      
      // Collect all comments and filter for top-level only
      const allComments = commentsData
        .map(comment => collectComments(comment, postData.id))
        .filter(comment => comment !== null);
      
      const topLevelComments = allComments
        .filter(comment => comment.isTopLevel)
        .slice(0, 10);
      
      console.log(`Total comments: ${allComments.length}, Top-level comments found: ${topLevelComments.length}`);
      
      const postContent = {
        title: postData.title,
        entries: [mainPost, ...topLevelComments]
      };
      
      setPostContent(postContent);
      
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
    setLastPostId(null); // Reset pagination when switching feeds
  };

  const handleCustomSubreddit = (e) => {
    e.preventDefault();
    const subreddit = customSubreddit.trim();
    if (subreddit) {
      // Remove r/ prefix if user includes it
      const cleanSubreddit = subreddit.replace(/^r\//i, '');
      selectFeed(cleanSubreddit);
      setCustomSubreddit(''); // Clear input after navigating
    }
  };

  // Smooth scrolling with momentum and buffering for Rabbit R1 device
  useEffect(() => {
    // Reset scroll state when view changes
    scrollVelocityRef.current = 0;
    scrollDirectionRef.current = 0;
    scrollBufferRef.current = [];
    lastTickTimeRef.current = Date.now();
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    
    // Constants for smooth scrolling
    const BASE_VELOCITY = 2;        // Start slow
    const MAX_VELOCITY = 15;        // Max speed when accelerating
    const ACCELERATION = 0.8;       // How fast we speed up
    const DECELERATION = 0.92;      // How fast we slow down (0.92 = retain 92% velocity each frame)
    const VELOCITY_THRESHOLD = 0.1; // Stop scrolling below this velocity
    const TICK_TIMEOUT = 150;       // Time to consider scrolling stopped (ms)
    
    // Smooth animation loop using requestAnimationFrame
    const animateScroll = () => {
      if (!postsContainerRef.current) return;
      
      const container = postsContainerRef.current;
      const now = Date.now();
      const timeSinceLastTick = now - lastTickTimeRef.current;
      
      // Check if we've received scroll ticks recently
      if (scrollBufferRef.current.length > 0 && timeSinceLastTick < TICK_TIMEOUT) {
        // We're actively scrolling - accelerate velocity
        const direction = scrollDirectionRef.current;
        scrollVelocityRef.current = Math.min(
          scrollVelocityRef.current + ACCELERATION,
          MAX_VELOCITY
        );
        
        // Apply the scroll
        if (Math.abs(scrollVelocityRef.current) > VELOCITY_THRESHOLD) {
          container.scrollTop += direction * scrollVelocityRef.current;
        }
        
        // Continue animation
        animationFrameRef.current = requestAnimationFrame(animateScroll);
      } else if (Math.abs(scrollVelocityRef.current) > VELOCITY_THRESHOLD) {
        // No recent ticks, but we have momentum - decelerate
        scrollVelocityRef.current *= DECELERATION;
        
        // Apply remaining momentum
        const direction = scrollDirectionRef.current;
        container.scrollTop += direction * scrollVelocityRef.current;
        
        // Continue animation
        animationFrameRef.current = requestAnimationFrame(animateScroll);
      } else {
        // Velocity too low, stop animation
        scrollVelocityRef.current = 0;
        scrollDirectionRef.current = 0;
        scrollBufferRef.current = [];
        animationFrameRef.current = null;
      }
    };
    
    // Handle individual scroll tick
    const handleScrollTick = (direction) => {
      const now = Date.now();
      
      // Add tick to buffer
      scrollBufferRef.current.push({ time: now, direction });
      
      // Clean old ticks from buffer (older than 200ms)
      scrollBufferRef.current = scrollBufferRef.current.filter(
        tick => now - tick.time < 200
      );
      
      // Update direction
      scrollDirectionRef.current = direction;
      lastTickTimeRef.current = now;
      
      // Start velocity from base if not already scrolling
      if (scrollVelocityRef.current < BASE_VELOCITY) {
        scrollVelocityRef.current = BASE_VELOCITY;
      }
      
      // Start animation loop if not already running
      if (!animationFrameRef.current) {
        animationFrameRef.current = requestAnimationFrame(animateScroll);
      }
    };

    // R1 scroll wheel events: directions are flipped!
    // "scrollUp" = wheel turns up = moves content DOWN (increase scrollTop)
    // "scrollDown" = wheel turns down = moves content UP (decrease scrollTop)
    const handleScrollDown = (event) => {
      event.preventDefault();
      handleScrollTick(-1); // scrollDown event = moves content UP
    };

    const handleScrollUp = (event) => {
      event.preventDefault();
      handleScrollTick(1); // scrollUp event = moves content DOWN
    };

    const handleKeyDown = (event) => {
      // Handle arrow keys for additional navigation support
      switch (event.key) {
        case 'ArrowUp':
          event.preventDefault();
          handleScrollTick(-1);
          break;
        case 'ArrowDown':
          event.preventDefault();
          handleScrollTick(1);
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

    // Cleanup event listeners and animation on component unmount
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
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

  // Helper function to clean content for display (handles both HTML and plain text)
  const cleanHtmlContent = (content) => {
    if (!content) return '';
    
    // If content contains HTML tags, parse it
    if (content.includes('<')) {
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = content;
      content = tempDiv.textContent || tempDiv.innerText || '';
    }
    
    // Remove Reddit-specific markup
    content = content.replace(/<!-- SC_OFF -->|<!-- SC_ON -->/g, '');
    content = content.replace(/^\s+|\s+$/g, ''); // Trim whitespace
    
    return content;
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
          <div className="version">v1.1</div>
          <div className="home-hero">
            <div className="reddit-logo">
              <div className="reddit-icon">r/</div>
              <h1 className="home-title">reddit</h1>
            </div>
            <p className="home-subtitle">for Rabbit R1</p>
          </div>
          <main className="main-menu-container">
            <form className="subreddit-input-form" onSubmit={handleCustomSubreddit}>
              <div className="input-wrapper">
                <input
                  type="text"
                  className="subreddit-input"
                  placeholder="Enter subreddit..."
                  value={customSubreddit}
                  onChange={(e) => setCustomSubreddit(e.target.value)}
                />
                <button type="submit" className="go-button">Go</button>
              </div>
            </form>
            <div className="buttons-with-rabbit">
              <div className="menu-buttons">
                <button className="main-menu-button popular-button" onClick={() => selectFeed('popular')}>
                  <span className="button-content">
                    <span className="button-title">Popular</span>
                    <span className="button-desc">Trending posts</span>
                  </span>
                </button>
                <button className="main-menu-button all-button" onClick={() => selectFeed('all')}>
                  <span className="button-content">
                    <span className="button-title">All</span>
                    <span className="button-desc">Everything</span>
                  </span>
                </button>
              </div>
              <button 
                className="peeking-rabbit" 
                onClick={() => selectFeed('rabbitr1')}
                title="Visit r/rabbitr1"
              >
                <span className="rabbit-art">{`(\\__/)\n(•ㅅ•)\n/ 　 づ`}</span>
              </button>
            </div>
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
              <button className="back-button" onClick={() => setCurrentView('main')}>←</button>
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
              <button className="back-button" onClick={() => setCurrentView('main')}>←</button>
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
            {lastPostId && (
              <button 
                className="load-more-button" 
                onClick={loadMorePosts}
                disabled={loadingMore}
              >
                {loadingMore ? 'Loading...' : 'Load More'}
              </button>
            )}
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
                {(() => {
                  // Find and display main post content separately
                  const mainPost = postContent.entries?.find(entry => entry.isMainPost);
                  if (mainPost) {
                    const content = cleanHtmlContent(mainPost.content);
                    if (content && content.trim().length > 0) {
                      return (
                        <div className="main-post-content">
                          {content}
                        </div>
                      );
                    }
                  }
                  return null;
                })()}
                {postContent.entries?.map((entry, index) => {
                  // Skip the main post since we already displayed it above
                  if (entry.isMainPost) {
                    return null;
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
