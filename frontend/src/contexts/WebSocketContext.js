import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';

const WebSocketContext = createContext(null);

export const useWebSocket = () => {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
};

export const WebSocketProvider = ({ children }) => {
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const listenersRef = useRef(new Map());

  const getWebSocketUrl = () => {
    // Determine WebSocket URL based on current environment
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname;

    // Development: use localhost:5001
    if (host === 'localhost' || host === '127.0.0.1') {
      return `ws://localhost:5001`;
    }

    // Production: use same host
    return `${protocol}//${host}`;
  };

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    // Prevent multiple simultaneous connection attempts
    if (wsRef.current?.readyState === WebSocket.CONNECTING) {
      console.log('WebSocket connection already in progress...');
      return;
    }

    try {
      const wsUrl = getWebSocketUrl();
      console.log('Connecting to WebSocket:', wsUrl);
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('WebSocket connected');
        setIsConnected(true);
        reconnectAttemptsRef.current = 0; // Reset on successful connection
        // Clear any pending reconnect attempts
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('WebSocket message received:', data);

          // Notify all registered listeners
          listenersRef.current.forEach((callback) => {
            callback(data);
          });
        } catch (e) {
          console.error('Failed to parse WebSocket message:', e);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error. Connection failed to:', wsUrl);
        console.error('Make sure the backend server is running on port 5001');
      };

      ws.onclose = () => {
        console.log('WebSocket disconnected');
        setIsConnected(false);
        wsRef.current = null;

        // Attempt to reconnect with exponential backoff (max 10 attempts)
        reconnectAttemptsRef.current += 1;
        const maxAttempts = 10;

        if (reconnectAttemptsRef.current <= maxAttempts) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current - 1), 30000); // Max 30s
          console.log(`Attempting to reconnect WebSocket in ${delay / 1000}s (attempt ${reconnectAttemptsRef.current}/${maxAttempts})...`);

          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
        } else {
          console.warn('WebSocket reconnection failed after maximum attempts. Please refresh the page.');
        }
      };

      wsRef.current = ws;
    } catch (error) {
      console.error('Failed to create WebSocket connection:', error);
    }
  }, []);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setIsConnected(false);
  }, []);

  const subscribe = useCallback((id, callback) => {
    listenersRef.current.set(id, callback);

    // Return unsubscribe function
    return () => {
      listenersRef.current.delete(id);
    };
  }, []);

  const send = useCallback((data) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    } else {
      console.warn('WebSocket is not connected');
    }
  }, []);

  useEffect(() => {
    // Connect on mount
    connect();

    // Don't disconnect on unmount - keep connection alive
    // Only disconnect when component is truly being destroyed
    return () => {
      // Do nothing - let connection persist
      // disconnect() will be called manually if needed
    };
  }, [connect]);

  const value = {
    isConnected,
    subscribe,
    send,
    connect,
    disconnect
  };

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  );
};
