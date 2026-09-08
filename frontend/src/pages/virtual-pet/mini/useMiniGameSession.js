import { useEffect, useState } from 'react';
import axios from 'axios';
import { API_BASE } from '../../../api';

export default function useMiniGameSession(critterId, game, token) {
  const [sessionId, setSessionId] = useState(null);
  const [sessionError, setSessionError] = useState('');

  useEffect(() => {
    let active = true;
    setSessionId(null);
    setSessionError('');
    if (!critterId || !token)
      return () => {
        active = false;
      };

    axios
      .post(
        `${API_BASE}/api/sanctuary/minigame/start`,
        { critterId, game },
        { headers: { Authorization: `Bearer ${token}` } }
      )
      .then(({ data }) => {
        if (active) setSessionId(data.sessionId);
      })
      .catch((error) => {
        if (active)
          setSessionError(error.response?.data?.error || 'Could not start a secure game session.');
      });

    return () => {
      active = false;
    };
  }, [critterId, game, token]);

  return { sessionId, sessionError };
}
