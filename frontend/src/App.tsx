import { useEffect, useState } from 'react';
import { initNative, syncNative } from './lib/native';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import Intro, { introSeen } from './components/Intro';
import Shell from './components/Shell';
import { Spinner } from './components/ui';
import { Forgot, Login, Register, ResetPassword, Restore, VerifyEmail, Welcome } from './pages/Auth';
import Dashboard from './pages/Dashboard';
import Planner from './pages/Planner';
import Reminders from './pages/Reminders';
import Analytics from './pages/Analytics';
import Growth from './pages/Growth';
import Notifications from './pages/Notifications';
import Settings from './pages/Settings';
import Shared from './pages/Shared';

function Protected() {
  const { user, loading } = useAuth();
  useEffect(() => { if (user) void initNative().then(syncNative); }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (loading) return <div className="grid h-full place-items-center"><Spinner /></div>;
  return user ? <Shell /> : <Navigate to="/welcome" replace />;
}

export default function App() {
  const [intro, setIntro] = useState(() => !introSeen() && !location.pathname.startsWith('/shared/'));
  return (
    <>
      {intro && <Intro onDone={() => setIntro(false)} />}
      <Routes>
        <Route path="/welcome" element={<Welcome />} />
        <Route path="/restore" element={<Restore />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot" element={<Forgot />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="/shared/:token" element={<Shared />} />
        <Route element={<Protected />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/planner" element={<Planner />} />
          <Route path="/reminders" element={<Reminders />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/growth" element={<Growth />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </>
  );
}
