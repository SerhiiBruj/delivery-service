import React from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import AuthModal from './components/AuthModal';
import CustomerView from './components/CustomerView';
import ManagerView from './components/ManagerView';
import CourierView from './components/CourierView';
import './index.css';

function AppContent() {
  const { user } = useAuth();

  // Route Guard: Якщо сесія відсутня — доступ тільки до форми авторизації
  if (!user) {
    return <AuthModal />;
  }

  // Роутинг та Контроль Доступу на основі умовного рендерингу ролей
  return (
    <Layout>
      {user.role === 'Customer' && <CustomerView />}
      {user.role === 'Restaurant Manager' && <ManagerView />}
      {user.role === 'Courier' && <CourierView />}
    </Layout>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}