/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect } from 'react';
import { Layout } from './components/Layout';
import { Dashboard } from './components/views/Dashboard';
import { Marketplace } from './components/views/Marketplace';
import { FinancialLayer } from './components/views/FinancialLayer';
import { NodeManagement } from './components/views/NodeManagement';
import { ComputeSession } from './components/views/ComputeSession';
import { Settings } from './components/views/Settings';
import { WalletProvider } from './context/WalletContext';
import { SessionProvider } from './context/SessionContext';
import { ToastProvider } from './context/ToastContext';
import { useHashRoute } from './hooks/useHashRoute';

const ROUTES = {
  dashboard: { title: 'Dashboard', view: Dashboard },
  marketplace: { title: 'Explore', view: Marketplace },
  compute: { title: 'Execute', view: ComputeSession },
  financial: { title: 'Finance', view: FinancialLayer },
  node: { title: 'My Nodes', view: NodeManagement },
  settings: { title: 'Settings', view: Settings },
} as const;

type RouteId = keyof typeof ROUTES;
const ROUTE_IDS = Object.keys(ROUTES) as RouteId[];

export default function App() {
  const [route, navigate] = useHashRoute<RouteId>(ROUTE_IDS, 'dashboard');
  const { title, view: View } = ROUTES[route];

  // Keep the tab title in step with the view, the way a multi-page app
  // would — it's what makes browser history readable.
  useEffect(() => {
    document.title = `${title} · BotCompute`;
  }, [title]);

  return (
    <WalletProvider>
      <ToastProvider>
        <SessionProvider>
          <Layout activeTab={route} setActiveTab={(tab) => navigate(tab as RouteId)}>
            <View />
          </Layout>
        </SessionProvider>
      </ToastProvider>
    </WalletProvider>
  );
}
