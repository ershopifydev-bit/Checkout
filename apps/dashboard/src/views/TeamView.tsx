import React from 'react';
import { useDashboard } from '../context/DashboardContext';

export const TeamView: React.FC = () => {
  const { showToast } = useDashboard();

  return (
    <>
      <div className="g g2">
        <div className="card">
          <h3>
            Users
            <em>
              <button className="btn" onClick={() => showToast('Invite sent')}>
                Invite user
              </button>
            </em>
          </h3>
          <div className="wide">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Access</th>
                  <th className="n">2FA</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Noor Hashmi', 'Admin', 'All brands', 'On', 'g'],
                  ['Erin Calloway', 'Brand manager', 'Kora Apparel', 'On', 'g'],
                  ['Tom Larkin', 'Finance', 'All brands', 'Off', 'o'],
                  ['Priya Shah', 'Support', 'Aarav Home', 'On', 'g'],
                ].map(([name, role, acc, tfa, tfaCl]) => (
                  <tr key={name} className="r">
                    <td>{name}</td>
                    <td>{role}</td>
                    <td>{acc}</td>
                    <td className="n">
                      <span className={`pill ${tfaCl}`}>{tfa}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <h3>
            Plan and usage<em>Growth · next invoice ₹48,200 on 1 Nov</em>
          </h3>
          {[
            ['Orders', '41,200 of 60,000', 69],
            ['OTP messages', '88,000 of 120,000', 73],
            ['WhatsApp messages', '9,400 of 20,000', 47],
          ].map(([label, sub, pct]) => (
            <div className="bar" key={label as string}>
              <span>{label}</span>
              <div>
                <i style={{ width: `${pct}%` }} />
              </div>
              <b style={{ fontSize: '11px' }}>{sub}</b>
            </div>
          ))}
          <button
            className="btn l"
            style={{ marginTop: '12px' }}
            onClick={() => showToast('Invoices downloading')}
          >
            Download invoices
          </button>
        </div>
      </div>

      <div className="g g2e">
        <div className="card">
          <h3>Role permissions</h3>
          <div className="wide">
            <table>
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Orders</th>
                  <th>Checkout</th>
                  <th>Payments</th>
                  <th className="n">Team</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Admin', 'Edit', 'Edit', 'Edit', 'Edit'],
                  ['Brand manager', 'Edit', 'Edit', 'View', 'None'],
                  ['Finance', 'View', 'None', 'Edit', 'None'],
                  ['Support', 'Edit', 'None', 'None', 'None'],
                ].map(([role, ords, chk, pay, team]) => (
                  <tr key={role} className="r">
                    <td>{role}</td>
                    <td>{ords}</td>
                    <td>{chk}</td>
                    <td>{pay}</td>
                    <td className="n">{team}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <h3>
            Audit log<em>Every change, with who and when</em>
          </h3>
          <ul className="tl">
            <li>
              Noor H. raised COD fee from ₹39 to ₹49
              <small>Checkout · 2 hours ago</small>
            </li>
            <li className="w">
              Tom L. rotated the ERP sync key
              <small>Integrations · Yesterday</small>
            </li>
            <li>
              Erin C. switched off wallets for Kora
              <small>Checkout · 3 days ago</small>
            </li>
          </ul>
        </div>
      </div>
    </>
  );
};
