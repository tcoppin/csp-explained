import content from 'virtual:content/fr';
import ReportReader from './ReportReader';

/** The ReportReader island in French, with its content from a cached module rather than a prop in the page. */
export default function ReportReaderFr() {
  return <ReportReader content={content} locale="fr" />;
}
