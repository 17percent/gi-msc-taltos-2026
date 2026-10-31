import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** shadcn-konvenció: feltételes osztályok összefűzése, a Tailwind-ütközések feloldásával. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
