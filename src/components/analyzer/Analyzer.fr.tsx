import content from 'virtual:content/fr';
import Analyzer from './Analyzer';

/** The Analyzer island in French, with its content from a cached module rather than a prop in the page. */
export default function AnalyzerFr() {
  return <Analyzer content={content} locale="fr" />;
}
