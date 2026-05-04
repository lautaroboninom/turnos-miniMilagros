import { useEffect, useRef } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import type { GalleryImage, StudioSettings } from '../types';
import Admin from './Admin';

const DEFAULT_GALLERY_IMAGES: GalleryImage[] = [
  { src: 'https://picsum.photos/seed/nails1/400/500', alt: 'Manicura' },
  { src: 'https://picsum.photos/seed/lashes1/400/400', alt: 'Pestanas' },
  { src: 'https://picsum.photos/seed/facial1/400/600', alt: 'Facial' },
  { src: 'https://picsum.photos/seed/spa1/400/400', alt: 'Spa' },
];

const normalizeText = (value: string) => (
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
);

const isValidHttpUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

const getConfigRoot = () => {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
  const saveButton = buttons.find((button) => normalizeText(button.textContent ?? '').includes('guardar configuracion'));
  return saveButton?.closest<HTMLElement>('.bg-background') ?? null;
};

const getCardImageUrl = (card: Element | null) => {
  const urlInput = card?.querySelector<HTMLInputElement>('input[type="url"]');
  const image = card?.querySelector<HTMLImageElement>('img');
  return (urlInput?.value || image?.currentSrc || image?.src || '').trim();
};

const collectSettingsFromPage = (): StudioSettings | null => {
  const root = getConfigRoot();
  if (!root) return null;

  const depositInput = root.querySelector<HTMLInputElement>('input[type="number"]');
  const depositAmount = Number(depositInput?.value ?? 0);

  const fileInputs = Array.from(root.querySelectorAll<HTMLInputElement>('input[type="file"][accept*="image"]'));
  const galleryImages = fileInputs
    .map((fileInput, index) => {
      const card = fileInput.closest('div.border');
      const textInputs = Array.from(card?.querySelectorAll<HTMLInputElement>('input[type="text"]') ?? []);
      const src = getCardImageUrl(card);
      const alt = textInputs[textInputs.length - 1]?.value.trim() || `Trabajo ${index + 1}`;
      return { src, alt };
    })
    .filter((image) => image.src && isValidHttpUrl(image.src));

  return {
    depositAmount: Number.isFinite(depositAmount) && depositAmount >= 0 ? depositAmount : 0,
    galleryImages: galleryImages.length > 0 ? galleryImages : DEFAULT_GALLERY_IMAGES,
    updatedAt: new Date().toISOString(),
  };
};

export default function AdminAutoSave() {
  const savingRef = useRef(false);

  useEffect(() => {
    const saveCurrentSettings = async (showAlert: boolean) => {
      if (savingRef.current) return;
      const nextSettings = collectSettingsFromPage();

      if (!nextSettings) {
        if (showAlert) alert('No se encontro la configuracion para guardar.');
        return;
      }

      try {
        savingRef.current = true;
        await setDoc(doc(db, 'settings', 'global'), nextSettings);
        if (showAlert) alert('Configuracion guardada');
      } catch (error: any) {
        console.error('Settings save error', error);
        const message = error?.code === 'permission-denied'
          ? 'No tenes permisos para guardar la configuracion. Revisa las reglas de Firestore.'
          : 'No se pudo guardar la configuracion. Revisa la conexion e intenta de nuevo.';
        alert(message);
      } finally {
        savingRef.current = false;
      }
    };

    const scheduleGalleryAutoSave = (fileInput: HTMLInputElement) => {
      const card = fileInput.closest('div.border');
      const initialUrl = getCardImageUrl(card);
      let attempts = 0;

      const timer = window.setInterval(() => {
        attempts += 1;
        const currentUrl = getCardImageUrl(card);
        const isStillUploading = normalizeText(card?.textContent ?? '').includes('subiendo imagen');

        if (currentUrl && currentUrl !== initialUrl && !isStillUploading) {
          window.clearInterval(timer);
          void saveCurrentSettings(false);
        }

        if (attempts >= 30) {
          window.clearInterval(timer);
        }
      }, 1000);
    };

    const handleClick = (event: MouseEvent) => {
      const button = (event.target as Element | null)?.closest('button');
      if (!button || !normalizeText(button.textContent ?? '').includes('guardar configuracion')) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      void saveCurrentSettings(true);
    };

    const handleChange = (event: Event) => {
      const input = event.target as HTMLInputElement | null;
      if (!input || input.type !== 'file' || !input.accept.includes('image')) return;

      const root = getConfigRoot();
      if (!root || !root.contains(input)) return;
      scheduleGalleryAutoSave(input);
    };

    document.addEventListener('click', handleClick, true);
    document.addEventListener('change', handleChange, true);

    return () => {
      document.removeEventListener('click', handleClick, true);
      document.removeEventListener('change', handleChange, true);
    };
  }, []);

  return <Admin />;
}
