export interface Service {
  id: string;
  name: string;
  durationMinutes: number;
  price: number;
  isActive: boolean;
  createdAt: string;
}

export interface Appointment {
  id: string;
  serviceId: string;
  serviceName: string;
  durationMinutes: number;
  price: number;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  clientFirstName: string;
  clientLastName: string;
  status: 'pending' | 'confirmed' | 'cancelled';
  depositAmount: number;
  createdAt: string;
}

export interface GalleryImage {
  src: string;
  alt: string;
}

export interface StudioSettings {
  depositAmount: number;
  updatedAt: string;
  galleryImages?: GalleryImage[];
}
