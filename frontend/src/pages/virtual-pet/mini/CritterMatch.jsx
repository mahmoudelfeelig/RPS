import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../../context/AuthContext';
import { API_BASE } from '../../../api';
import axios from 'axios';
import toast from 'react-hot-toast';
import useMiniGameSession from './useMiniGameSession';

const EMOJIS = ['🦊', '🐱', '🐻', '🐸'];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function CritterMatch({ critter, onExit }) {
  const { token } = useAuth();
  const { sessionId, sessionError } = useMiniGameSession(critter?._id, 'critter-match', token);
  const [cards, setCards] = useState([]);
  const [flipped, setFlipped] = useState([]);
  const [matched, setMatched] = useState([]);

  useEffect(() => {
    const deck = shuffle([...EMOJIS, ...EMOJIS]).map((icon, idx) => ({
      id: idx,
      icon,
    }));
    setCards(deck);
  }, []);

  const handleFlip = (id) => {
    if (flipped.length === 2 || flipped.includes(id) || matched.includes(id)) return;
    const next = [...flipped, id];
    setFlipped(next);
    if (next.length === 2) {
      setTimeout(() => {
        const [c1, c2] = next.map((i) => cards.find((c) => c.id === i));
        if (c1.icon === c2.icon) setMatched((m) => [...m, ...next]);
        setFlipped([]);
      }, 700);
    }
  };

  const postScore = useCallback(() => {
    if (!critter?._id || !sessionId) return;
    axios
      .post(
        `${API_BASE}/api/sanctuary/minigame/complete`,
        {
          critterId: critter._id,
          game: 'critter-match',
          actualScore: 100,
          sessionId,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      )
      .catch((err) => {
        const msg =
          err.response?.data?.error || err.response?.data?.message || 'Server error saving score.';
        toast.error(msg);
        console.error('CritterMatch error:', err);
      })
      .finally(() => onExit?.());
  }, [critter?._id, onExit, sessionId, token]);

  useEffect(() => {
    if (cards.length && matched.length === cards.length) {
      toast.success('All pairs matched.');
      postScore();
    }
  }, [matched, cards, postScore]);

  return (
    <div className="flex flex-col items-center gap-4">
      <h5 className="font-semibold text-white">Critter Match</h5>
      {sessionError && <p className="text-sm text-red-300">{sessionError}</p>}

      <div className="grid grid-cols-4 gap-3">
        {cards.map((c) => (
          <button
            key={c.id}
            disabled={!sessionId}
            onClick={() => handleFlip(c.id)}
            className="flex h-20 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.08] text-2xl text-white shadow-lg transition hover:-translate-y-0.5 hover:bg-white/[0.14]"
          >
            {flipped.includes(c.id) || matched.includes(c.id) ? c.icon : '?'}
          </button>
        ))}
      </div>

      <button
        className="btn-red"
        onClick={() => {
          onExit?.();
        }}
      >
        Leave Game ✖
      </button>
    </div>
  );
}
