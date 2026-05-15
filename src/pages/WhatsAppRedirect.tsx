import { useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';

const normalizeWhatsAppPhone = (value: string) => value.replace(/\D/g, '');

const buildWebWhatsAppUrl = (phone: string, text: string) => (
  `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
);

const buildAppWhatsAppUrl = (phone: string, text: string) => (
  `whatsapp://send?phone=${phone}&text=${encodeURIComponent(text)}`
);

export default function WhatsAppRedirect() {
  const location = useLocation();
  const navigate = useNavigate();

  const { phone, text, appUrl, webUrl } = useMemo(() => {
    const search = new URLSearchParams(location.search);
    const nextPhone = normalizeWhatsAppPhone(search.get('phone') ?? '');
    const nextText = search.get('text') ?? '';

    return {
      phone: nextPhone,
      text: nextText,
      appUrl: nextPhone && nextText ? buildAppWhatsAppUrl(nextPhone, nextText) : '',
      webUrl: nextPhone && nextText ? buildWebWhatsAppUrl(nextPhone, nextText) : '',
    };
  }, [location.search]);

  useEffect(() => {
    if (!appUrl || !webUrl) return;

    const fallbackTimer = window.setTimeout(() => {
      window.location.replace(webUrl);
    }, 900);

    const cancelFallback = () => {
      window.clearTimeout(fallbackTimer);
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        cancelFallback();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    try {
      window.location.assign(appUrl);
    } catch {
      window.location.replace(webUrl);
    }

    return () => {
      cancelFallback();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [appUrl, webUrl]);

  return (
    <Layout>
      <div className="mx-auto max-w-lg rounded-[20px] border border-primary-container bg-background p-6 text-center shadow-sm">
        <h1 className="mb-3 text-2xl font-serif text-primary">Abriendo WhatsApp</h1>
        <p className="mb-6 text-sm text-on-surface-variant">
          Estamos preparando el mensaje para enviar a la duena con la informacion de la reserva.
        </p>

        {phone && text ? (
          <div className="space-y-3">
            <a
              href={webUrl}
              className="block w-full rounded-xl bg-primary-dim px-6 py-3 text-center text-sm font-medium text-white no-underline transition-opacity hover:opacity-90"
            >
              Abrir WhatsApp ahora
            </a>
            <button
              type="button"
              onClick={() => navigate('/', { replace: true })}
              className="w-full rounded-xl border border-outline-variant bg-white px-6 py-3 text-sm font-medium text-on-surface"
            >
              Volver al inicio
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="rounded-xl border border-error-container bg-error-container px-4 py-3 text-sm text-error">
              Falta la informacion necesaria para abrir WhatsApp.
            </p>
            <button
              type="button"
              onClick={() => navigate('/', { replace: true })}
              className="w-full rounded-xl border border-outline-variant bg-white px-6 py-3 text-sm font-medium text-on-surface"
            >
              Volver al inicio
            </button>
          </div>
        )}
      </div>
    </Layout>
  );
}
