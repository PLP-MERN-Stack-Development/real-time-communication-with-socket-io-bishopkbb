import React, { useState, useEffect, useRef, createContext, useContext } from 'react';
import { io } from 'socket.io-client';
import { Send, Users, MessageCircle, Bell, LogOut, Smile, Check, CheckCheck, User } from 'lucide-react';

// Contexts
const SocketContext = createContext(null);
const AuthContext = createContext(null);

// Main App Component
function App() {
  const [authToken, setAuthToken] = useState(localStorage.getItem('token'));
  const [currentUser, setCurrentUser] = useState(null);
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    if (authToken) {
      const newSocket = io('http://localhost:3001', {
        auth: { token: authToken },
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: 5
      });

      newSocket.on('connect', () => {
        console.log('Connected to server');
      });

      newSocket.on('user:connected', (data) => {
        setCurrentUser(data.user);
      });

      newSocket.on('connect_error', (err) => {
        console.error('Connection error:', err);
        if (err.message === 'Authentication error') {
          handleLogout();
        }
      });

      setSocket(newSocket);

      return () => {
        newSocket.close();
      };
    }
  }, [authToken]);

  const handleLogout = () => {
    localStorage.removeItem('token');
    setAuthToken(null);
    setCurrentUser(null);
    if (socket) socket.close();
  };

  const handleLogin = (token, user) => {
    localStorage.setItem('token', token);
    setAuthToken(token);
    setCurrentUser(user);
  };

  if (!authToken) {
    return <AuthScreen onLogin={handleLogin} />;
  }

  if (!socket || !currentUser) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Connecting to server...</p>
        </div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ currentUser, logout: handleLogout }}>
      <SocketContext.Provider value={socket}>
        <ChatApplication />
      </SocketContext.Provider>
    </AuthContext.Provider>
  );
}

// Auth Screen Component
function AuthScreen({ onLogin }) {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register';
      const response = await fetch(`http://localhost:3001${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Authentication failed');
      }

      onLogin(data.token, data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <div className="text-center mb-8">
            <div className="bg-indigo-600 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <MessageCircle className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-3xl font-bold text-gray-900">ChatSocket</h1>
            <p className="text-gray-600 mt-2">Real-time messaging made simple</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                placeholder="Enter username"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                placeholder="Enter password"
                required
              />
            </div>

            {error && (
              <div className="bg-red-50 text-red-600 px-4 py-2 rounded-lg text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 text-white py-2 rounded-lg hover:bg-indigo-700 transition disabled:opacity-50"
            >
              {loading ? 'Processing...' : (isLogin ? 'Sign In' : 'Sign Up')}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button
              onClick={() => setIsLogin(!isLogin)}
              className="text-indigo-600 hover:text-indigo-700 text-sm"
            >
              {isLogin ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Chat Application Component
function ChatApplication() {
  const socket = useContext(SocketContext);
  const { currentUser } = useContext(AuthContext);
  const [activeView, setActiveView] = useState('rooms');
  const [currentRoom, setCurrentRoom] = useState('general');
  const [rooms] = useState([
    { id: 'general', name: 'General', description: 'General discussion' },
    { id: 'random', name: 'Random', description: 'Random topics' }
  ]);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [unreadCounts, setUnreadCounts] = useState({});

  useEffect(() => {
    socket.on('users:online', (users) => {
      setOnlineUsers(users);
    });

    return () => {
      socket.off('users:online');
    };
  }, [socket]);

  return (
    <div className="h-screen flex bg-gray-100">
      <div className="w-64 bg-indigo-900 text-white flex flex-col">
        <div className="p-4 border-b border-indigo-800">
          <div className="flex items-center space-x-3">
            <img src={currentUser.avatar} alt="" className="w-10 h-10 rounded-full" />
            <div className="flex-1 min-w-0">
              <p className="font-semibold truncate">{currentUser.username}</p>
              <p className="text-xs text-indigo-300">Online</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-2">
          <button
            onClick={() => setActiveView('rooms')}
            className={`w-full flex items-center space-x-3 px-4 py-2 rounded-lg transition ${
              activeView === 'rooms' ? 'bg-indigo-800' : 'hover:bg-indigo-800'
            }`}
          >
            <MessageCircle className="w-5 h-5" />
            <span>Rooms</span>
          </button>

          <button
            onClick={() => setActiveView('users')}
            className={`w-full flex items-center space-x-3 px-4 py-2 rounded-lg transition ${
              activeView === 'users' ? 'bg-indigo-800' : 'hover:bg-indigo-800'
            }`}
          >
            <Users className="w-5 h-5" />
            <span>Direct Messages</span>
            {Object.keys(unreadCounts).length > 0 && (
              <span className="ml-auto bg-red-500 text-xs px-2 py-1 rounded-full">
                {Object.values(unreadCounts).reduce((a, b) => a + b, 0)}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveView('notifications')}
            className={`w-full flex items-center space-x-3 px-4 py-2 rounded-lg transition ${
              activeView === 'notifications' ? 'bg-indigo-800' : 'hover:bg-indigo-800'
            }`}
          >
            <Bell className="w-5 h-5" />
            <span>Notifications</span>
            {notifications.length > 0 && (
              <span className="ml-auto bg-red-500 text-xs px-2 py-1 rounded-full">
                {notifications.length}
              </span>
            )}
          </button>
        </nav>

        <LogoutButton />
      </div>

      <div className="flex-1 flex flex-col">
        {activeView === 'rooms' && (
          <RoomChat 
            currentRoom={currentRoom} 
            setCurrentRoom={setCurrentRoom}
            rooms={rooms}
            setNotifications={setNotifications}
          />
        )}
        {activeView === 'users' && (
          <DirectMessages 
            onlineUsers={onlineUsers}
            unreadCounts={unreadCounts}
            setUnreadCounts={setUnreadCounts}
            setNotifications={setNotifications}
          />
        )}
        {activeView === 'notifications' && (
          <NotificationsPanel 
            notifications={notifications}
            setNotifications={setNotifications}
          />
        )}
      </div>
    </div>
  );
}

// Room Chat Component
function RoomChat({ currentRoom, setCurrentRoom, rooms, setNotifications }) {
  const socket = useContext(SocketContext);
  const { currentUser } = useContext(AuthContext);
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [typingUsers, setTypingUsers] = useState([]);
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  useEffect(() => {
    socket.emit('room:join', currentRoom);

    socket.on('room:messages', (data) => {
      if (data.roomId === currentRoom) {
        setMessages(data.messages);
      }
    });

    socket.on('message:new', (message) => {
      if (message.roomId === currentRoom) {
        setMessages(prev => [...prev, message]);
        scrollToBottom();
        
        if (message.userId !== currentUser.id) {
          playNotificationSound();
          setNotifications(prev => [...prev, {
            id: Date.now(),
            type: 'message',
            text: `${message.username} sent a message in ${rooms.find(r => r.id === currentRoom)?.name}`,
            timestamp: new Date()
          }]);
        }
      }
    });

    socket.on('typing:update', (data) => {
      if (data.roomId === currentRoom) {
        setTypingUsers(data.users);
      }
    });

    socket.on('message:reaction_update', ({ messageId, reactions }) => {
      setMessages(prev => prev.map(msg => 
        msg.id === messageId ? { ...msg, reactions } : msg
      ));
    });

    socket.on('room:user_joined', (data) => {
      if (data.roomId === currentRoom) {
        setNotifications(prev => [...prev, {
          id: Date.now(),
          type: 'join',
          text: `${data.user.username} joined the room`,
          timestamp: new Date()
        }]);
      }
    });

    return () => {
      socket.off('room:messages');
      socket.off('message:new');
      socket.off('typing:update');
      socket.off('message:reaction_update');
      socket.off('room:user_joined');
    };
  }, [socket, currentRoom]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!inputMessage.trim()) return;

    socket.emit('message:send', {
      roomId: currentRoom,
      content: inputMessage,
      type: 'text'
    });

    setInputMessage('');
    socket.emit('typing:stop', currentRoom);
    setIsTyping(false);
  };

  const handleTyping = () => {
    if (!isTyping) {
      socket.emit('typing:start', currentRoom);
      setIsTyping(true);
    }

    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      socket.emit('typing:stop', currentRoom);
      setIsTyping(false);
    }, 2000);
  };

  const handleReaction = (messageId, reaction) => {
    socket.emit('message:react', {
      messageId,
      roomId: currentRoom,
      reaction
    });
  };

  const playNotificationSound = () => {
    const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYIG2m98OScTgwOUKnk77RgGwU7k9n0yHUpBSp+zPLaizsKGGS56+mnUBELTKXh8bllHAU2jdXzzn0vBSh6y/HajDwKF2G35+yoUhELTqbh8bllHAU4j9f0yHQoBSh5y/HajDwKF2G35+yoUhELTqbh8bllHAU4j9f0yHQoBSh5y/HajDwKF2G35+yoUhELTqbh8bllHAU4j9f0yHQoBSh5y/HajDwKF2G35+yoUhELTqbh8bllHAU4j9f0yHQoBSh5y/HajDwKF2G35+yoUhELTqbh8bllHAU4j9f0yHQoBSh5y/HajDwKF2G35+yoUhELTqbh8bllHAU4j9f0yHQoBSh5y/HajDwKF2G35+yoUhELTqbh8bllHAU4j9f0yHQo');
    audio.volume = 0.3;
    audio.play().catch(() => {});
  };

  return (
    <div className="flex flex-col h-full">
      <div className="bg-white border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900">
              #{rooms.find(r => r.id === currentRoom)?.name || currentRoom}
            </h2>
            <p className="text-sm text-gray-500">
              {rooms.find(r => r.id === currentRoom)?.description}
            </p>
          </div>
          <div className="flex space-x-2">
            {rooms.map(room => (
              <button
                key={room.id}
                onClick={() => setCurrentRoom(room.id)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                  currentRoom === room.id
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {room.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-gray-50">
        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            isOwn={message.userId === currentUser.id}
            onReact={handleReaction}
          />
        ))}
        {typingUsers.length > 0 && (
          <div className="text-sm text-gray-500 italic">
            {typingUsers.join(', ')} {typingUsers.length === 1 ? 'is' : 'are'} typing...
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="bg-white border-t p-4">
        <form onSubmit={handleSendMessage} className="flex items-center space-x-2">
          <input
            type="text"
            value={inputMessage}
            onChange={(e) => {
              setInputMessage(e.target.value);
              handleTyping();
            }}
            placeholder="Type a message..."
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />
          <button
            type="submit"
            className="bg-indigo-600 text-white p-2 rounded-lg hover:bg-indigo-700 transition"
          >
            <Send className="w-5 h-5" />
          </button>
        </form>
      </div>
    </div>
  );
}

// Message Bubble Component
function MessageBubble({ message, isOwn, onReact }) {
  const [showReactions, setShowReactions] = useState(false);
  const reactions = ['👍', '❤️', '😂', '😮', '😢', '🎉'];

  return (
    <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex items-start space-x-2 max-w-lg ${isOwn ? 'flex-row-reverse space-x-reverse' : ''}`}>
        <img src={message.avatar} alt="" className="w-8 h-8 rounded-full" />
        <div>
          <div className={`px-4 py-2 rounded-2xl ${
            isOwn ? 'bg-indigo-600 text-white' : 'bg-white text-gray-900'
          }`}>
            {!isOwn && (
              <p className="text-xs font-semibold mb-1 text-indigo-600">{message.username}</p>
            )}
            <p className="break-words">{message.content}</p>
            <p className={`text-xs mt-1 ${isOwn ? 'text-indigo-200' : 'text-gray-500'}`}>
              {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
          
          <div className="flex items-center space-x-2 mt-1">
            {Object.entries(message.reactions || {}).map(([emoji, users]) => (
              users.length > 0 && (
                <button
                  key={emoji}
                  onClick={() => onReact(message.id, emoji)}
                  className="flex items-center space-x-1 bg-gray-100 rounded-full px-2 py-1 text-xs hover:bg-gray-200"
                >
                  <span>{emoji}</span>
                  <span className="text-gray-600">{users.length}</span>
                </button>
              )
            ))}
            <button
              onClick={() => setShowReactions(!showReactions)}
              className="text-gray-400 hover:text-gray-600"
            >
              <Smile className="w-4 h-4" />
            </button>
          </div>

          {showReactions && (
            <div className="flex space-x-1 mt-2 bg-white rounded-lg shadow-lg p-2">
              {reactions.map(emoji => (
                <button
                  key={emoji}
                  onClick={() => {
                    onReact(message.id, emoji);
                    setShowReactions(false);
                  }}
                  className="hover:scale-125 transition text-xl"
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Direct Messages Component
function DirectMessages({ onlineUsers, unreadCounts, setUnreadCounts, setNotifications }) {
  const socket = useContext(SocketContext);
  const { currentUser } = useContext(AuthContext);
  const [selectedUser, setSelectedUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const messagesEndRef = useRef(null);

  useEffect(() => {
    socket.on('private:new', (message) => {
      if (selectedUser && 
          (message.senderId === selectedUser.id || message.recipientId === selectedUser.id)) {
        setMessages(prev => [...prev, message]);
        scrollToBottom();
        
        if (message.senderId === selectedUser.id) {
          socket.emit('private:read', { senderId: selectedUser.id });
        }
      } else if (message.senderId !== currentUser.id) {
        setUnreadCounts(prev => ({
          ...prev,
          [message.senderId]: (prev[message.senderId] || 0) + 1
        }));
        
        const sender = onlineUsers.find(u => u.id === message.senderId);
        setNotifications(prev => [...prev, {
          id: Date.now(),
          type: 'dm',
          text: `New message from ${sender?.username || 'Someone'}`,
          timestamp: new Date()
        }]);
      }
    });

    socket.on('private:messages', (data) => {
      if (selectedUser && data.recipientId === selectedUser.id) {
        setMessages(data.messages);
        scrollToBottom();
      }
    });

    return () => {
      socket.off('private:new');
      socket.off('private:messages');
    };
  }, [socket, selectedUser, currentUser.id]);

  useEffect(() => {
    if (selectedUser) {
      socket.emit('private:load', selectedUser.id);
      socket.emit('private:read', { senderId: selectedUser.id });
      setUnreadCounts(prev => {
        const newCounts = { ...prev };
        delete newCounts[selectedUser.id];
        return newCounts;
      });
    }
  }, [selectedUser]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!inputMessage.trim() || !selectedUser) return;

    socket.emit('private:send', {
      recipientId: selectedUser.id,
      content: inputMessage,
      type: 'text'
    });

    setInputMessage('');
  };

  return (
    <div className="flex h-full">
      <div className="w-64 bg-white border-r overflow-y-auto">
        <div className="p-4 border-b">
          <h3 className="font-semibold text-gray-900">Direct Messages</h3>
        </div>
        <div className="divide-y">
          {onlineUsers.filter(u => u.id !== currentUser.id).map(user => (
            <button
              key={user.id}
              onClick={() => setSelectedUser(user)}
              className={`w-full p-4 flex items-center space-x-3 hover:bg-gray-50 transition ${
                selectedUser?.id === user.id ? 'bg-indigo-50' : ''
              }`}
            >
              <div className="relative">
                <img src={user.avatar} alt="" className="w-10 h-10 rounded-full" />
                <span className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-white rounded-full"></span>
              </div>
              <div className="flex-1 text-left">
                <p className="font-medium text-gray-900">{user.username}</p>
                <p className="text-xs text-green-600">Online</p>
              </div>
              {unreadCounts[user.id] > 0 && (
                <span className="bg-indigo-600 text-white text-xs px-2 py-1 rounded-full">
                  {unreadCounts[user.id]}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {selectedUser ? (
        <div className="flex-1 flex flex-col">
          <div className="bg-white border-b px-6 py-4">
            <div className="flex items-center space-x-3">
              <img src={selectedUser.avatar} alt="" className="w-10 h-10 rounded-full" />
              <div>
                <h3 className="font-semibold text-gray-900">{selectedUser.username}</h3>
                <p className="text-xs text-green-600">Online</p>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-gray-50">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.senderId === currentUser.id ? 'justify-end' : 'justify-start'}`}
              >
                <div className={`max-w-lg px-4 py-2 rounded-2xl ${
                  message.senderId === currentUser.id
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white text-gray-900'
                }`}>
                  <p className="break-words">{message.content}</p>
                  <div className="flex items-center justify-end space-x-1 mt-1">
                    <p className={`text-xs ${
                      message.senderId === currentUser.id ? 'text-indigo-200' : 'text-gray-500'
                    }`}>
                      {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                    {message.senderId === currentUser.id && (
                      message.read ? 
                        <CheckCheck className="w-3 h-3 text-indigo-200" /> :
                        <Check className="w-3 h-3 text-indigo-200" />
                    )}
                  </div>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          <div className="bg-white border-t p-4">
            <form onSubmit={handleSendMessage} className="flex items-center space-x-2">
              <input
                type="text"
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                placeholder="Type a message..."
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
              <button
                type="submit"
                className="bg-indigo-600 text-white p-2 rounded-lg hover:bg-indigo-700 transition"
              >
                <Send className="w-5 h-5" />
              </button>
            </form>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center bg-gray-50">
          <div className="text-center text-gray-500">
            <MessageCircle className="w-16 h-16 mx-auto mb-4 text-gray-400" />
            <p className="text-lg font-medium">Select a user to start chatting</p>
          </div>
        </div>
      )}
    </div>
  );
}

// Notifications Panel Component
function NotificationsPanel({ notifications, setNotifications }) {
  return (
    <div className="flex-1 bg-white">
      <div className="p-6 border-b">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900">Notifications</h2>
          {notifications.length > 0 && (
            <button
              onClick={() => setNotifications([])}
              className="text-sm text-indigo-600 hover:text-indigo-700"
            >
              Clear all
            </button>
          )}
        </div>
      </div>

      <div className="divide-y">
        {notifications.length === 0 ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-center text-gray-500">
              <Bell className="w-16 h-16 mx-auto mb-4 text-gray-400" />
              <p>No notifications</p>
            </div>
          </div>
        ) : (
          notifications.map((notif) => (
            <div key={notif.id} className="p-4 hover:bg-gray-50">
              <div className="flex items-start space-x-3">
                <div className={`p-2 rounded-lg ${
                  notif.type === 'message' ? 'bg-blue-100' :
                  notif.type === 'dm' ? 'bg-purple-100' : 'bg-green-100'
                }`}>
                  {notif.type === 'message' ? <MessageCircle className="w-5 h-5 text-blue-600" /> :
                   notif.type === 'dm' ? <User className="w-5 h-5 text-purple-600" /> :
                   <Users className="w-5 h-5 text-green-600" />}
                </div>
                <div className="flex-1">
                  <p className="text-gray-900">{notif.text}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {new Date(notif.timestamp).toLocaleTimeString()}
                  </p>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// Logout Button Component
function LogoutButton() {
  const { logout } = useContext(AuthContext);

  return (
    <div className="p-4 border-t border-indigo-800">
      <button
        onClick={logout}
        className="w-full flex items-center space-x-3 px-4 py-2 text-indigo-200 hover:bg-indigo-800 rounded-lg transition"
      >
        <LogOut className="w-5 h-5" />
        <span>Logout</span>
      </button>
    </div>
  );
}

export default App;