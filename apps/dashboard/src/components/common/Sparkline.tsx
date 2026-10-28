import React from 'react';

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
}

export const Sparkline: React.FC<SparklineProps> = ({ data, width = 100, height = 32 }) => {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;

  const points = data
    .map((v, i) => {
      const x = ((i * width) / (data.length - 1)).toFixed(1);
      const y = (height - 3 - ((v - min) / range) * (height - 6)).toFixed(1);
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg className="sp" viewBox={`0 0 ${width} ${height}`}>
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};
