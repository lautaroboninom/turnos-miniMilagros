import { Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import Booking from './pages/Booking';
import AdminAutoSave from './pages/AdminAutoSave';
import WhatsAppRedirect from './pages/WhatsAppRedirect';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/reservar/:serviceId" element={<Booking />} />
      <Route path="/redirigir-whatsapp" element={<WhatsAppRedirect />} />
      <Route path="/admin" element={<AdminAutoSave />} />
    </Routes>
  );
}
