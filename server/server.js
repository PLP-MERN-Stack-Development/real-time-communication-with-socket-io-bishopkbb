const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Configure CORS
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true
}));

app.use(express.json());

// Socket.io configuration
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
    credentials: true
  },
  pingTimeout: 60000,
  pingInterval: 25000
});

// In-memory data storage (replace with database in production)
const users = new Map(); // userId -> user data
const messages = []; // Array of all messages
const rooms = new Map(); // roomId -> room data
const privateMessages = new Map(); // conversationId -> messages
const onlineUsers = new Map(); // socketId -> userId
const userSockets = new Map(); // userId -> Set of socketIds
const typingUsers = new Map(); // roomId -> Set of userIds

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Default rooms
rooms.set('general', {
  id: 'general',
  name: 'General',
  description: 'General discussion',
  messages: [],
  users: new Set()
});

rooms.set('random', {
  id: 'random',
  name: 'Random',
  description: 'Random topics',
  messages: [],
  users: new Set()
});

// REST API endpoints
app.post('/api/auth/register', (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  // Check if user exists
  const existingUser = Array.from(users.values()).find(u => u.username === username);
  if (existingUser) {
    return res.status(400).json({ error: 'Username already exists' });
  }

  const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const user = {
    id: userId,
    username,
    password, // In production, hash this!
    avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=random`,
    createdAt: new Date().toISOString()
  };

  users.set(userId, user);

  const token = jwt.sign({ userId, username }, JWT_SECRET, { expiresIn: '7d' });
  
  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      avatar: user.avatar
    }
  });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const user = Array.from(users.values()).find(
    u => u.username === username && u.password === password
  );

  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
  
  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      avatar: user.avatar
    }
  });
});

app.get('/api/rooms', (req, res) => {
  const roomList = Array.from(rooms.values()).map(room => ({
    id: room.id,
    name: room.name,
    description: room.description,
    userCount: room.users.size
  }));
  res.json(roomList);
});

// Socket.io middleware for authentication
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  
  if (!token) {
    return next(new Error('Authentication error'));
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.userId = decoded.userId;
    socket.username = decoded.username;
    next();
  } catch (err) {
    next(new Error('Authentication error'));
  }
});

// Socket.io connection handler
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.username} (${socket.id})`);

  // Track user connection
  onlineUsers.set(socket.id, socket.userId);
  
  if (!userSockets.has(socket.userId)) {
    userSockets.set(socket.userId, new Set());
  }
  userSockets.get(socket.userId).add(socket.id);

  const user = users.get(socket.userId);
  
  // Send user info and online users
  socket.emit('user:connected', {
    user: {
      id: user.id,
      username: user.username,
      avatar: user.avatar
    }
  });

  // Broadcast user online status
  io.emit('users:online', getOnlineUsers());

  // Join general room by default
  socket.join('general');
  if (rooms.has('general')) {
    rooms.get('general').users.add(socket.userId);
  }

  // Send room messages
  socket.emit('room:messages', {
    roomId: 'general',
    messages: rooms.get('general').messages.slice(-50)
  });

  // Room events
  socket.on('room:join', (roomId) => {
    socket.join(roomId);
    
    if (rooms.has(roomId)) {
      rooms.get(roomId).users.add(socket.userId);
      
      // Send room messages
      socket.emit('room:messages', {
        roomId,
        messages: rooms.get(roomId).messages.slice(-50)
      });

      // Notify room
      io.to(roomId).emit('room:user_joined', {
        roomId,
        user: {
          id: user.id,
          username: user.username,
          avatar: user.avatar
        }
      });
    }
  });

  socket.on('room:leave', (roomId) => {
    socket.leave(roomId);
    
    if (rooms.has(roomId)) {
      rooms.get(roomId).users.delete(socket.userId);
      
      io.to(roomId).emit('room:user_left', {
        roomId,
        userId: socket.userId,
        username: user.username
      });
    }
  });

  // Message events
  socket.on('message:send', (data) => {
    const { roomId, content, type = 'text' } = data;
    
    const message = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      roomId,
      userId: socket.userId,
      username: user.username,
      avatar: user.avatar,
      content,
      type,
      timestamp: new Date().toISOString(),
      reactions: {},
      readBy: [socket.userId]
    };

    if (rooms.has(roomId)) {
      rooms.get(roomId).messages.push(message);
      
      // Broadcast message to room
      io.to(roomId).emit('message:new', message);
      
      // Stop typing indicator
      stopTyping(socket, roomId);
    }
  });

  // Private message events
  socket.on('private:send', (data) => {
    const { recipientId, content, type = 'text' } = data;
    
    const conversationId = getConversationId(socket.userId, recipientId);
    
    const message = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      conversationId,
      senderId: socket.userId,
      recipientId,
      senderName: user.username,
      avatar: user.avatar,
      content,
      type,
      timestamp: new Date().toISOString(),
      read: false
    };

    if (!privateMessages.has(conversationId)) {
      privateMessages.set(conversationId, []);
    }
    privateMessages.get(conversationId).push(message);

    // Send to recipient
    const recipientSockets = userSockets.get(recipientId);
    if (recipientSockets) {
      recipientSockets.forEach(socketId => {
        io.to(socketId).emit('private:new', message);
      });
    }

    // Send back to sender
    socket.emit('private:new', message);
  });

  socket.on('private:load', (recipientId) => {
    const conversationId = getConversationId(socket.userId, recipientId);
    const messages = privateMessages.get(conversationId) || [];
    
    socket.emit('private:messages', {
      recipientId,
      messages: messages.slice(-50)
    });
  });

  socket.on('private:read', (data) => {
    const { senderId } = data;
    const conversationId = getConversationId(socket.userId, senderId);
    const messages = privateMessages.get(conversationId) || [];
    
    messages.forEach(msg => {
      if (msg.recipientId === socket.userId) {
        msg.read = true;
      }
    });

    // Notify sender
    const senderSockets = userSockets.get(senderId);
    if (senderSockets) {
      senderSockets.forEach(socketId => {
        io.to(socketId).emit('private:read_receipt', {
          userId: socket.userId,
          conversationId
        });
      });
    }
  });

  // Typing indicators
  socket.on('typing:start', (roomId) => {
    if (!typingUsers.has(roomId)) {
      typingUsers.set(roomId, new Set());
    }
    typingUsers.get(roomId).add(socket.userId);
    
    socket.to(roomId).emit('typing:update', {
      roomId,
      users: Array.from(typingUsers.get(roomId))
        .map(id => users.get(id)?.username)
        .filter(Boolean)
    });
  });

  socket.on('typing:stop', (roomId) => {
    stopTyping(socket, roomId);
  });

  // Message reactions
  socket.on('message:react', (data) => {
    const { messageId, roomId, reaction } = data;
    
    if (rooms.has(roomId)) {
      const room = rooms.get(roomId);
      const message = room.messages.find(m => m.id === messageId);
      
      if (message) {
        if (!message.reactions[reaction]) {
          message.reactions[reaction] = [];
        }
        
        if (!message.reactions[reaction].includes(socket.userId)) {
          message.reactions[reaction].push(socket.userId);
        } else {
          message.reactions[reaction] = message.reactions[reaction].filter(id => id !== socket.userId);
        }
        
        io.to(roomId).emit('message:reaction_update', {
          messageId,
          reactions: message.reactions
        });
      }
    }
  });

  // Message read receipts
  socket.on('message:read', (data) => {
    const { messageId, roomId } = data;
    
    if (rooms.has(roomId)) {
      const room = rooms.get(roomId);
      const message = room.messages.find(m => m.id === messageId);
      
      if (message && !message.readBy.includes(socket.userId)) {
        message.readBy.push(socket.userId);
        
        io.to(roomId).emit('message:read_update', {
          messageId,
          readBy: message.readBy
        });
      }
    }
  });

  // Disconnect handler
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.username} (${socket.id})`);
    
    // Remove from online users
    onlineUsers.delete(socket.id);
    
    const socketSet = userSockets.get(socket.userId);
    if (socketSet) {
      socketSet.delete(socket.id);
      if (socketSet.size === 0) {
        userSockets.delete(socket.userId);
        
        // User is completely offline
        io.emit('users:online', getOnlineUsers());
        
        // Remove from rooms
        rooms.forEach((room, roomId) => {
          if (room.users.has(socket.userId)) {
            room.users.delete(socket.userId);
            io.to(roomId).emit('room:user_left', {
              roomId,
              userId: socket.userId,
              username: user.username
            });
          }
        });
      }
    }
    
    // Remove from typing indicators
    typingUsers.forEach((users, roomId) => {
      if (users.has(socket.userId)) {
        users.delete(socket.userId);
        io.to(roomId).emit('typing:update', {
          roomId,
          users: Array.from(users).map(id => users.get(id)?.username).filter(Boolean)
        });
      }
    });
  });
});

// Helper functions
function getOnlineUsers() {
  const uniqueUserIds = new Set(onlineUsers.values());
  return Array.from(uniqueUserIds).map(userId => {
    const user = users.get(userId);
    return user ? {
      id: user.id,
      username: user.username,
      avatar: user.avatar
    } : null;
  }).filter(Boolean);
}

function getConversationId(userId1, userId2) {
  return [userId1, userId2].sort().join('_');
}

function stopTyping(socket, roomId) {
  if (typingUsers.has(roomId)) {
    typingUsers.get(roomId).delete(socket.userId);
    socket.to(roomId).emit('typing:update', {
      roomId,
      users: Array.from(typingUsers.get(roomId))
        .map(id => users.get(id)?.username)
        .filter(Boolean)
    });
  }
}

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 Socket.io ready for connections`);
});