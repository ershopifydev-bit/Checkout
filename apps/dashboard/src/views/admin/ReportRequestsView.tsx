import React from 'react';

const QUEUE_ITEMS = [
  {
    brand: 'Kora Apparel',
    req: 'RTO by pincode, Q3',
    user: 'Noor H.',
    due: 'Today',
    status: 'In progress',
    statusCl: 'b',
  },
  {
    brand: 'Nilgiri Tea Co.',
    req: 'Festive sales forecast',
    user: 'Erin C.',
    due: '28 Oct',
    status: 'Queued',
    statusCl: 'n',
  },
  {
    brand: 'Aarav Home',
    req: 'Coupon ROI',
    user: 'Tom L.',
    due: '29 Oct',
    status: 'Queued',
    statusCl: 'n',
  },
  {
    brand: 'Kestrel Sports',
    req: 'Cohort retention',
    user: 'Noor H.',
    due: 'Overdue',
    status: 'At risk',
    statusCl: 'o',
  },
];

export const ReportRequestsView: React.FC = () => {
  return (
    <div className="card">
      <h3>
        Queue<em>5 open</em>
      </h3>
      <div className="wide">
        <table>
          <thead>
            <tr>
              <th>Brand</th>
              <th>Request</th>
              <th>Assignee</th>
              <th>Due</th>
              <th className="n">Status</th>
            </tr>
          </thead>
          <tbody>
            {QUEUE_ITEMS.map((item) => (
              <tr key={item.brand + item.req} className="r">
                <td>{item.brand}</td>
                <td>{item.req}</td>
                <td>{item.user}</td>
                <td>{item.due}</td>
                <td className="n">
                  <span className={`pill ${item.statusCl}`}>{item.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
