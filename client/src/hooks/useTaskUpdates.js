import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

export default function useTaskUpdates(token, setRefresh, logout) {
  const [connection, setConnection] = useState('connecting');
  useEffect(() => {
    const socket = io({ auth: { token }, autoConnect: false });
    let refreshTimer;
    let retryTimer;
    // Coalesce bursts of server notifications into one REST refresh.
    function refresh() {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => setRefresh(value => value + 1), 100);
    }
    socket.on('connect', () => {
      clearTimeout(retryTimer);
      setConnection('connected');
      // Also recover events missed while this client was disconnected.
      refresh();
    });
    socket.on('tasks:changed', refresh);
    socket.on('disconnect', reason => {
      setConnection('disconnected');
      if (reason === 'io server disconnect') logout('Your session has ended. Please sign in again.');
    });
    socket.on('connect_error', error => {
      setConnection('disconnected');
      if (error.data?.code === 'AUTH_FAILED') logout('Your session has ended. Please sign in again.');
      else if (error.data?.code === 'SERVICE_UNAVAILABLE') {
        clearTimeout(retryTimer);
        retryTimer = setTimeout(() => socket.connect(), 3000);
      }
    });
    socket.connect();
    return () => {
      clearTimeout(refreshTimer);
      clearTimeout(retryTimer);
      socket.removeAllListeners();
      socket.disconnect();
    };
    // setRefresh is stable; logout only uses React's stable state setters.
    // Reconnect when the JWT changes, not on every dashboard render.
  }, [token, setRefresh]);
  return connection;
}
