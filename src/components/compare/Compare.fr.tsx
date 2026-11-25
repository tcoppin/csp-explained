import content from 'virtual:content/fr';
import Compare from './Compare';

/** The Compare island in French, with its content from a cached module rather than a prop in the page. */
export default function CompareFr() {
  return <Compare content={content} locale="fr" />;
}
