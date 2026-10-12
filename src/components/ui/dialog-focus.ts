import { createContext } from 'react';
import type { Dialog as DialogPrimitive } from '@base-ui/react/dialog';

/** A loading boundary preserves the original opener for the resolved dialog. */
export const DialogFocusContext =
  createContext<DialogPrimitive.Popup.Props['finalFocus']>(undefined);
