import content from 'virtual:content/en';
import Compare from './Compare';

/** The Compare island in English, with its content from a cached module rather than a prop in the page. */
export default function CompareEn() {
  return <Compare content={content} locale="en" />;
}
