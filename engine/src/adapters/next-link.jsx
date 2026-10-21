import React from 'react';
// Stand-in for next/link: a plain anchor. The film never navigates, so an href that is not a string becomes '#'.
export default function Link({href, prefetch, ...anchorProps}) {
  return <a href={typeof href === 'string' ? href : '#'} {...anchorProps} />;
}
