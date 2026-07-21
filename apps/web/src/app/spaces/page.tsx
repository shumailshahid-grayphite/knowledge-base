import { redirect } from 'next/navigation';

// Spaces are now an implicit single "Company Knowledge Base"; navigate by folders.
export default function SpacesRedirect() {
  redirect('/');
}
