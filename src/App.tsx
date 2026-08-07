/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Layout } from './components/Layout';
import { Dashboard } from './components/views/Dashboard';
import { Marketplace } from './components/views/Marketplace';
import { FinancialLayer } from './components/views/FinancialLayer';
import { NodeManagement } from './components/views/NodeManagement';
import { ComputeSession } from './components/views/ComputeSession';
import { WalletProvider } from './context/WalletContext';

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <Dashboard />;
      case 'marketplace':
        return <Marketplace />;
      case 'compute':
        return <ComputeSession />;
      case 'financial':
        return <FinancialLayer />;
      case 'node':
        return <NodeManagement />;
      case 'settings':
        return <div className="p-8 text-on-surface">Settings view coming soon...</div>;
      default:
        return <Dashboard />;
    }
  };

  return (
    <WalletProvider>
      <Layout activeTab={activeTab} setActiveTab={setActiveTab}>
        {renderContent()}
      </Layout>
    </WalletProvider>
  );
}

