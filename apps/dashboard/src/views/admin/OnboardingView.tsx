import React from 'react';

const COLUMNS = [
  [
    'KYC',
    [
      ['Brightleaf Foods', 'Docs under review'],
      ['Mesa Pottery', 'GST pending'],
    ],
  ],
  ['Integration', [['Urban Looms', 'Shopify app installing']]],
  [
    'Testing',
    [
      ['Kestrel Sports', '2 test orders left'],
      ['Aarav Home', 'COD rules check'],
    ],
  ],
  ['Live', [['Sahyadri Group', 'Went live 12 Oct']]],
] as const;

export const OnboardingView: React.FC = () => {
  return (
    <div className="board">
      {COLUMNS.map(([title, items]) => (
        <div className="col card" key={title}>
          <h3>
            {title}
            <em>{items.length}</em>
          </h3>
          {items.map(([name, sub]) => (
            <div className="tk" key={name}>
              <b>{name}</b>
              <small>{sub}</small>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};
