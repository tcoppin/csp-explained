import content from 'virtual:content/fr';
import Builder from './Builder';

/** The Builder island in French, with its content from a cached module rather than a prop in the page. */
export default function BuilderFr() {
  return <Builder content={content} locale="fr" />;
}
