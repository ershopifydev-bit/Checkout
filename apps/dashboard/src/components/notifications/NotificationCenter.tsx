import React, { useRef, useEffect } from 'react';
import { useDashboard } from '../../context/DashboardContext';
import type { NotificationItem } from '../../types';

interface NotificationCenterProps {
  isOpen: boolean;
  onClose: () => void;
  notifications: NotificationItem[];
  onDismiss: (id: string) => void;
  onMarkAllRead: () => void;
}

export const NotificationCenter: React.FC<NotificationCenterProps> = ({
  isOpen,
  onClose,
  notifications,
  onDismiss,
  onMarkAllRead,
}) => {
  const { setTab, showToast } = useDashboard();
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const unreadCount = notifications.filter((n) => !n.read).length;

  const handleNotificationClick = (item: NotificationItem) => {
    if (item.tabTarget) {
      setTab(item.tabTarget);
      showToast(`Navigated to ${item.tabTarget}`);
      onClose();
    }
  };

  return (
    <div
      ref={dropdownRef}
      style={{
        position: 'absolute',
        top: '52px',
        right: '48px',
        width: '360px',
        maxHeight: '480px',
        backgroundColor: 'var(--card)',
        borderRadius: '12px',
        border: '1px solid var(--line)',
        boxShadow: '0 16px 36px rgba(0,0,0,0.2)',
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '14px 16px',
          borderBottom: '1px solid var(--line)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: 'var(--card)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <b style={{ fontSize: '15px' }}>Notifications</b>
          {unreadCount > 0 && (
            <span
              style={{
                background: 'var(--or, #ea580c)',
                color: '#fff',
                borderRadius: '10px',
                padding: '2px 8px',
                fontSize: '11px',
                fontWeight: 600,
              }}
            >
              {unreadCount} unread
            </span>
          )}
        </div>

        {unreadCount > 0 && (
          <button
            onClick={onMarkAllRead}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--blue, #2563eb)',
              fontSize: '12px',
              padding: 0,
            }}
          >
            Mark all read
          </button>
        )}
      </div>

      <div style={{ overflowY: 'auto', flex: 1, padding: '8px' }}>
        {notifications.length === 0 ? (
          <div style={{ padding: '36px 16px', textAlign: 'center', color: 'var(--mut)' }}>
            <div style={{ fontSize: '24px', marginBottom: '8px' }}>🔔</div>
            <strong style={{ fontSize: '14px', display: 'block', color: 'var(--ink)' }}>
              All caught up!
            </strong>
            <span style={{ fontSize: '12px' }}>No unread alerts or notifications at this time.</span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {notifications.map((n) => {
              let dotColor = 'var(--blue, #2563eb)';
              if (n.type === 'warning' || n.type === 'alert') dotColor = 'var(--or, #ea580c)';
              else if (n.type === 'success') dotColor = 'var(--gr, #16a34a)';

              return (
                <div
                  key={n.id}
                  style={{
                    padding: '12px 14px',
                    borderRadius: '8px',
                    backgroundColor: n.read ? 'transparent' : 'var(--bg)',
                    border: '1px solid var(--line)',
                    cursor: n.tabTarget ? 'pointer' : 'default',
                    transition: 'background 0.15s',
                    position: 'relative',
                  }}
                  onClick={() => handleNotificationClick(n)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span
                        style={{
                          width: '8px',
                          height: '8px',
                          borderRadius: '50%',
                          backgroundColor: dotColor,
                          display: 'inline-block',
                          flexShrink: 0,
                        }}
                      />
                      <strong style={{ fontSize: '13px', color: 'var(--ink)' }}>{n.title}</strong>
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDismiss(n.id);
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'var(--mut)',
                        fontSize: '13px',
                        padding: '0 4px',
                        lineHeight: 1,
                      }}
                      title="Dismiss"
                    >
                      ✕
                    </button>
                  </div>

                  <p
                    style={{
                      margin: '6px 0 6px 14px',
                      fontSize: '12px',
                      color: 'var(--mut)',
                      lineHeight: 1.4,
                    }}
                  >
                    {n.description}
                  </p>

                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginLeft: '14px',
                    }}
                  >
                    <span style={{ fontSize: '11px', color: 'var(--mut)' }}>{n.time}</span>
                    {n.tabTarget && (
                      <span style={{ fontSize: '11px', color: 'var(--blue)', fontWeight: 500 }}>
                        View in {n.tabTarget} →
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
