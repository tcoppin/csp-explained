import content from 'virtual:content/en';
import Builder from './Builder';

/** The Builder island in English, with its content from a cached module rather than a prop in the page. */
export default function BuilderEn() {
  return <Builder content={content} locale="en" />;
}
