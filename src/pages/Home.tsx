import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, doc, onSnapshot, query } from 'firebase/firestore';
import { GalleryImage, Service, StudioSettings } from '../types';
import { useNavigate } from 'react-router-dom';

const DEFAULT_GALLERY_IMAGES: GalleryImage[] = [
  { src: 'https://picsum.photos/seed/nails1/400/500', alt: 'Manicura' },
  { src: 'https://picsum.photos/seed/lashes1/400/400', alt: 'Pestanas' },
  { src: 'https://picsum.photos/seed/facial1/400/600', alt: 'Facial' },
  { src: 'https://picsum.photos/seed/spa1/400/400', alt: 'Spa' },
];

export default function Home() {
  const [services, setServices] = useState<Service[]>([]);
  const [galleryImages, setGalleryImages] = useState<GalleryImage[]>(DEFAULT_GALLERY_IMAGES);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const q = query(collection(db, 'services'));
    const unsubscribeServices = onSnapshot(q, (snapshot) => {
      const svcs: Service[] = [];
      snapshot.forEach((item) => {
        svcs.push({ id: item.id, ...item.data() } as Service);
      });
      setServices(svcs.filter(s => s.isActive).sort((a, b) => a.name.localeCompare(b.name)));
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'services');
      setLoading(false);
    });

    const unsubscribeSettings = onSnapshot(doc(db, 'settings', 'global'), (snapshot) => {
      if (!snapshot.exists()) {
        setGalleryImages(DEFAULT_GALLERY_IMAGES);
        return;
      }

      const data = snapshot.data() as StudioSettings;
      if (!Array.isArray(data.galleryImages) || data.galleryImages.length === 0) {
        setGalleryImages(DEFAULT_GALLERY_IMAGES);
        return;
      }

      const sanitizedGallery = data.galleryImages
        .filter((img): img is GalleryImage => typeof img?.src === 'string')
        .map((img) => ({
          src: img.src.trim(),
          alt: typeof img.alt === 'string' && img.alt.trim() ? img.alt.trim() : 'Trabajo',
        }))
        .filter((img) => img.src.length > 0);

      setGalleryImages(sanitizedGallery.length > 0 ? sanitizedGallery : DEFAULT_GALLERY_IMAGES);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'settings/global');
    });

    return () => {
      unsubscribeServices();
      unsubscribeSettings();
    };
  }, []);

  return (
    <Layout>
      <div className="text-center mb-12 relative z-10 px-4">
        <h1 className="text-[32px] md:text-[40px] font-serif text-primary tracking-tight mb-3">
          Cuidá tu belleza natural
        </h1>
        <p className="text-on-surface-variant text-[14px]">
          Agendá tu turno online en nuestro estudio
        </p>
      </div>

      <div id="servicios" className="mb-16">
        <h2 className="text-[18px] font-medium text-on-surface mb-4">Seleccioná tu servicio</h2>
        {loading ? (
          <p className="text-on-surface-variant">Cargando servicios...</p>
        ) : (
          <div className="flex flex-col">
            {services.length === 0 ? (
              <p className="text-on-surface-variant text-[14px] bg-white border border-outline-variant rounded-xl p-4 text-center">Próximamente agregaremos nuestros servicios.</p>
            ) : (
              services.map((service) => (
                <div
                  key={service.id}
                  className="bg-background border border-primary-container p-4 rounded-[16px] cursor-pointer hover:bg-primary-container hover:border-primary-dim transition-all group"
                  onClick={() => navigate(`/reservar/${service.id}`)}
                >
                  <div className="flex items-center gap-4">
                    {service.imageUrl && (
                      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-outline-variant bg-surface-container-highest">
                        <img src={service.imageUrl} alt={service.name} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <h3 className="font-sans text-[15px] font-medium text-primary mb-1">{service.name}</h3>
                      <span className="text-[12px] text-on-surface-variant">{service.durationMinutes} min • Servicio</span>
                    </div>
                    <span className="shrink-0 text-[14px] font-bold text-primary">${service.price.toLocaleString('es-AR')}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <div className="mb-16">
        <h2 className="text-[18px] font-medium text-on-surface mb-4">Nuestros Trabajos</h2>
        <div className="columns-2 gap-4 space-y-4">
          {galleryImages.map((img, index) => (
            <div key={`${img.src}-${index}`} className="relative rounded-[20px] overflow-hidden break-inside-avoid">
              <img src={img.src} alt={img.alt} className="w-full object-cover rounded-[20px]" referrerPolicy="no-referrer" />
              <div className="absolute inset-0 bg-gradient-to-t from-primary/60 to-transparent opacity-0 hover:opacity-100 transition-opacity flex items-end p-4">
                <span className="text-on-primary font-serif">{img.alt}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Layout>
  );
}
