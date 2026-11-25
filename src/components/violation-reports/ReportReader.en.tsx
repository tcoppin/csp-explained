import content from 'virtual:content/en';
import ReportReader from './ReportReader';

/** The ReportReader island in English, with its content from a cached module rather than a prop in the page. */
export default function ReportReaderEn() {
  return <ReportReader content={content} locale="en" />;
}
