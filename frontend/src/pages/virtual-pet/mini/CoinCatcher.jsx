import React, { useCallback, useRef, useEffect, useState } from 'react';
import { useAuth } from '../../../context/AuthContext';
import { API_BASE } from '../../../api';
import axios from 'axios';
import toast from 'react-hot-toast';
import useMiniGameSession from './useMiniGameSession';

function circleRectCollision(cx, cy, r, rx, ry, rw, rh) {
  const closestX = Math.max(rx, Math.min(cx, rx + rw));
  const closestY = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - closestX;
  const dy = cy - closestY;
  return dx * dx + dy * dy <= r * r;
}

export default function CoinCatcher({ critter, onExit }) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const { token } = useAuth();
  const { sessionId, sessionError } = useMiniGameSession(critter?._id, 'coin-catcher', token);

  const runningRef = useRef(false);
  const quitOnce = useRef(false);
  const scoreRef = useRef(0);
  const expertRef = useRef(false);

  const [score, setScore] = useState(0);
  const [expert, setExpert] = useState(false);
  const [countdown, setCountdown] = useState(null);
  const countdownRef = useRef(countdown);
  useEffect(() => {
    countdownRef.current = countdown;
  }, [countdown]);

  const toggleExpert = () => {
    expertRef.current = !expertRef.current;
    setExpert((e) => !e);
  };

  useEffect(() => {
    if (countdown > 0) {
      const id = setTimeout(() => setCountdown((c) => (c > 0 ? c - 1 : 0)), 1000);
      return () => clearTimeout(id);
    }
  }, [countdown]);

  const quit = useCallback(
    (post = true) => {
      if (quitOnce.current) return;
      quitOnce.current = true;
      const final = scoreRef.current;
      toast.info(`Run complete. Score ${final}`);
      if (post && final > 0 && critter?._id && sessionId) {
        axios
          .post(
            `${API_BASE}/api/sanctuary/minigame/complete`,
            { critterId: critter._id, game: 'coin-catcher', actualScore: final, sessionId },
            { headers: { Authorization: `Bearer ${token}` } }
          )
          .catch((err) => {
            const msg = err.response?.data?.message || 'Server error saving score.';
            toast.error(msg);
          });
      }
      onExit?.();
    },
    [critter?._id, onExit, sessionId, token]
  );

  useEffect(() => {
    const cvs = canvasRef.current;
    const ctx = cvs.getContext('2d');

    function resize() {
      const rect = containerRef.current.getBoundingClientRect();
      cvs.width = rect.width;
      cvs.height = rect.height;
    }
    resize();
    window.addEventListener('resize', resize);

    function handleStartKey(e) {
      if (countdownRef.current === null && e.key === 'Enter' && sessionId) {
        setCountdown(3);
        runningRef.current = true;
      }
    }
    window.addEventListener('keydown', handleStartKey);

    function down(e) {
      keys[e.key.toLowerCase()] = true;
    }
    function up(e) {
      keys[e.key.toLowerCase()] = false;
    }
    function esc(e) {
      if (e.key === 'Escape') {
        runningRef.current = false;
        quit();
      }
    }
    const keys = {};
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('keydown', esc);

    const scale = cvs.width / 320;
    const DRAW_R = 7 * scale;
    const COLLIDE_R = DRAW_R - scale;
    const BASE_PS = 8 * scale;
    const BOTTOM_BUF = 40 * scale;
    const PLAYER_W = 40 * scale;
    const PLAYER_H = 22 * scale;

    const traits = Array.isArray(critter?.traits) ? critter.traits : [];
    const hasTrait = (t) => traits.includes(t);
    const baseInterval = hasTrait('forager') ? 10 : 15;

    let playerX = (cvs.width - PLAYER_W) / 2;
    let coins = [{ x: cvs.width / 2, y: 0, v: (6 + Math.random() * 3) * scale }];
    let bombs = [];
    let tick = 0;
    let frameCount = 0;

    function drop() {
      const factor = expertRef.current ? 2 : 1;
      const x = Math.random() * (cvs.width - 2 * DRAW_R) + DRAW_R;
      const v = (6 + Math.random() * 3) * scale * factor;
      coins.push({ x, y: -DRAW_R, v });
      if (Math.random() < 0.4) {
        bombs.push({ x, y: -DRAW_R, v });
      }
    }

    function loop() {
      const w = cvs.width,
        h = cvs.height;

      if (countdownRef.current === null) {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 24px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Press ENTER to start', w / 2, h / 2);
        return requestAnimationFrame(loop);
      }

      if (countdownRef.current > 0) {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 72px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(countdownRef.current, w / 2, h / 2 + 24);
        return requestAnimationFrame(loop);
      }

      if (!runningRef.current) {
        if (frameCount > 60) quit();
        return;
      }
      frameCount++;

      const factor = expertRef.current ? 2 : 1;

      if (keys['arrowleft'] || keys['a']) playerX -= BASE_PS * factor;
      if (keys['arrowright'] || keys['d']) playerX += BASE_PS * factor;
      playerX = Math.max(0, Math.min(w - PLAYER_W, playerX));

      const interval = Math.max(1, Math.floor(baseInterval / factor));
      if (tick % interval === 0) drop();
      tick++;

      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);

      ctx.fillStyle = '#ffd95c';
      coins.forEach((c) => {
        c.y += c.v;
        ctx.beginPath();
        ctx.arc(c.x, c.y, DRAW_R, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.fillStyle = '#ff6161';
      bombs.forEach((b) => {
        b.y += b.v;
        ctx.beginPath();
        ctx.arc(b.x, b.y, DRAW_R, 0, Math.PI * 2);
        ctx.fill();
      });

      ctx.fillStyle = '#9b5de5';
      const playerY = h - BOTTOM_BUF;
      ctx.fillRect(playerX, playerY, PLAYER_W, PLAYER_H);

      coins = coins.filter((c) => {
        const hit = circleRectCollision(c.x, c.y, COLLIDE_R, playerX, playerY, PLAYER_W, PLAYER_H);
        if (hit) {
          let gain = hasTrait('cheerful') ? 2 : 1;
          if (hasTrait('splashy') && Math.random() < 0.1) gain *= 2;
          scoreRef.current += gain;
          setScore(scoreRef.current);
        }
        return !hit && c.y - DRAW_R < h;
      });
      bombs = bombs.filter((b) => {
        const hit = circleRectCollision(b.x, b.y, COLLIDE_R, playerX, playerY, PLAYER_W, PLAYER_H);
        if (hit) runningRef.current = false;
        return !hit && b.y - DRAW_R < h;
      });

      requestAnimationFrame(loop);
    }

    requestAnimationFrame(loop);

    return () => {
      runningRef.current = false;
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', handleStartKey);
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('keydown', esc);
    };
  }, [token, critter?._id, critter?.traits, onExit, quit, sessionId]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/78 backdrop-blur-xl"
      onClick={() => {
        runningRef.current = false;
        quit();
      }}
    >
      <div
        ref={containerRef}
        className="relative overflow-hidden rounded-[28px] border border-white/10 bg-black/45 p-4 shadow-[0_28px_90px_rgba(0,0,0,0.55)]"
        style={{ width: '80vw', height: '80vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h5 className="font-semibold text-white">Coin Catcher · {score}</h5>
        {sessionError && <p className="text-sm text-red-300">{sessionError}</p>}
        <label className="flex items-center space-x-2 text-white mb-2">
          <input
            type="checkbox"
            checked={expert}
            onChange={toggleExpert}
            className="form-checkbox"
          />
          <span>Expert Mode (2× speed)</span>
        </label>

        <canvas
          ref={canvasRef}
          className="border border-white/50"
          style={{ width: '100%', height: 'calc(100% - 3rem)', display: 'block' }}
          onClick={(e) => e.stopPropagation()}
        />

        <button
          className="btn-red absolute top-2 right-2"
          onClick={() => {
            runningRef.current = false;
            quit();
          }}
        >
          Exit ✖
        </button>
      </div>
    </div>
  );
}
