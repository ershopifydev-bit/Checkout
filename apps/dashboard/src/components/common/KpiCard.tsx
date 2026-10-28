import React from 'react';
import { Sparkline } from './Sparkline';

interface KpiCardProps {
  icon: string;
  label: string;
  value: string;
  sub: string;
  variant?: 'dk' | 'bl' | 'or' | '' | undefined;
  sparkline?: number[];
}

export const KpiCard: React.FC<KpiCardProps> = ({
  icon,
  label,
  value,
  sub,
  variant = '',
  sparkline,
}) => {
  return (
    <div className={`card kpi ${variant}`}>
      <div className="kh">
        <i>{icon}</i>
        {label}
      </div>
      <div className="kv">{value}</div>
      <div className="kf">
        <span>{sub}</span>
        {sparkline && <Sparkline data={sparkline} />}
      </div>
    </div>
  );
};
