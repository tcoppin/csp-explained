import content from 'virtual:content/en';
import Analyzer from './Analyzer';

/** The Analyzer island in English, with its content from a cached module rather than a prop in the page. */
export default function AnalyzerEn() {
  return <Analyzer content={content} locale="en" />;
}
