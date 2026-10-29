const paths: Record<string, string> = {
  Dashboard: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  Orders: 'M6 3h12v18l-3-2-3 2-3-2-3 2z M9 8h6 M9 12h6',
  Abandoned: 'M3 4h2l3 12h10l3-9H6 M9 20h.01 M18 20h.01 M12 7v4 M10 9h4',
  Checkout: 'M3 5h18v14H3z M3 9h18 M7 14h4',
  Payments: 'M3 6h18v14H3z M3 10h18 M7 16h3',
  Logistics:
    'M3 5h11v12H3z M14 9h4l3 4v4h-7 M7 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4 M17 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4',
  Customers:
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M17 4a4 4 0 0 1 0 7 M22 21v-2a4 4 0 0 0-3-4',
  Discounts: 'M3 3h9l9 9-9 9-9-9z M7 7h.01',
  Stores: 'M4 10v11h16V10 M2 10l3-7h14l3 7z M9 21v-7h6v7',
  Integrations: 'M8 3v4 M16 3v4 M6 7h12v4a6 6 0 0 1-12 0z M12 17v4',
  Reports: 'M4 3v18h17 M8 17v-5 M13 17V8 M18 17V4',
  Team: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M19 8v6 M16 11h6',
  Settings: 'M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6',
};
export function NavigationIcon({ name }: { name: string }) {
  return (
    <svg
      className="dashboard-nav-icon"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] || paths['Dashboard']} />
    </svg>
  );
}
