import React, { useEffect, useState } from 'react';
import { useDashboard } from '../context/DashboardContext';

export const Toast: React.FC = () => {
  const { toastMsg } = useDashboard();
  const [visible, setVisible] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (toastMsg) {
      setMsg(toastMsg);
      setVisible(true);
      const timer = setTimeout(() => {
        setVisible(false);
      }, 2400);
      return () => clearTimeout(timer);
    }
  }, [toastMsg]);

  return (
    <div className={`toast ${visible ? 'on' : ''}`} role="status">
      {msg}
    </div>
  );
};
