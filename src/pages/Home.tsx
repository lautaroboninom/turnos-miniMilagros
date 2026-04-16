import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { Service } from '../types';
import { useNavigate } from 'react-router-dom';

const GALLERY_IMAGES = [
  { id: 1, src: 'https://picsum.photos/seed/nails1/400/500', alt: 'Manicura' },
  { id: 2, src: 'https://picsum.photos/seed/lashes1/400/400', alt: 'Pestañas' },
  { id: 3, src: 'https://picsum.photos/seed/facial1/400/600', alt: 'Facial' },
  { id: 4, src: 'https://picsum.photos/seed/spa1/400/400', alt: 'Spa' },
];

export default function Home() {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const q = query(collection(db, 'services'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const svcs: Service[] = [];
      snapshot.forEach((doc) => {
        svcs.push({ id: doc.id, ...doc.data() } as Service);
      });
      // Show active first
      setServices(svcs.filter(s => s.isActive).sort((a, b) => a.name.localeCompare(b.name)));
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'services');
      setLoading(false);
    });

    return () => unsubscribe();
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

      <div id="servicios">
        <h2 className="text-[18px] font-medium text-on-surface mb-4">Selecciona tu servicio</h2>
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
                  <div className="flex justify-between items-center">
                    <div>
                      <h3 className="font-sans text-[15px] font-medium text-primary mb-1">{service.name}</h3>
                      <span className="text-[12px] text-on-surface-variant">{service.durationMinutes} min • Servicio</span>
                    </div>
                    <span className="text-[14px] font-bold text-primary">${service.price.toLocaleString('es-AR')}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <div className="mt-16">
        <h2 className="text-[18px] font-medium text-on-surface mb-4">Nuestros trabajos</h2>
        <div className="columns-2 gap-4 space-y-4">
          {GALLERY_IMAGES.map((img) => (
            <div key={img.id} className="relative rounded-[20px] overflow-hidden break-inside-avoid">
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
