import React from 'react';
// Stand-in for next/image: a plain <img>. The film has no image optimizer. With `fill` the image covers its
// positioned parent instead of taking explicit dimensions.
const COVER = {position: 'absolute', inset: 0, width: '100%', height: '100%'};

export default function Image(props) {
  const {src, alt = '', width, height, fill, priority, unoptimized, className, style, ...rest} = props;
  const url = typeof src === 'string' ? src : src?.src;
  return (
    <img
      src={url}
      alt={alt}
      className={className}
      style={fill ? {...COVER, ...style} : style}
      width={fill ? undefined : width}
      height={fill ? undefined : height}
      {...rest}
    />
  );
}
