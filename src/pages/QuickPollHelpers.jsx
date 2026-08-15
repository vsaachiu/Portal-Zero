import React from 'react';

export const isImageQuestion = (question) => question?.type === 'image' || question?.type === 2 || question?.type === '2';

export const parseCoordinates = (answer) => {
  if (Array.isArray(answer) && answer.length === 2) {
    return answer.map(Number);
  }

  try {
    const parsed = JSON.parse(answer);
    return Array.isArray(parsed) && parsed.length === 2 ? parsed.map(Number) : null;
  } catch {
    return null;
  }
};

export const formatCoordinates = ([x, y]) => `[${Number(x).toFixed(2)}, ${Number(y).toFixed(2)}]`;

export const coordinateDistance = (responseAnswer, targetAnswer) => {
  const response = parseCoordinates(responseAnswer);
  const target = parseCoordinates(targetAnswer);
  if (!response || !target) return null;
  return Math.hypot(response[0] - target[0], response[1] - target[1]);
};

export function ImageMap({ src, alt, onSelect, markers = [], className = '' }) {
  return (
    <div className={`relative w-full overflow-hidden bg-gray-100 ${className}`}>
      <img
        src={src}
        alt={alt}
        onClick={(event) => {
          if (!onSelect) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          onSelect([
            ((event.clientX - bounds.left) / bounds.width) * 100,
            ((event.clientY - bounds.top) / bounds.height) * 100,
          ]);
        }}
        className={`block h-auto w-full object-contain ${onSelect ? 'cursor-crosshair' : ''}`}
      />
      {markers.map((marker, index) => (
        <span
          key={`${marker.label || marker.color}-${index}`}
          title={marker.label}
          className={`absolute h-4 w-4 rounded-full border-2 border-white shadow ${marker.color || 'bg-blue-600'}`}
          style={{ left: `${marker.coordinates[0]}%`, top: `${marker.coordinates[1]}%`, transform: 'translate(-50%, -50%)' }}
        />
      ))}
    </div>
  );
}

export function WordCloud({ responses }) {
  const frequencies = responses.reduce((counts, response) => {
    String(response.answer || '')
      .toLowerCase()
      .match(/[a-z0-9']{3,}/g)
      ?.forEach((word) => {
        counts[word] = (counts[word] || 0) + 1;
      });
    return counts;
  }, {});
  const words = Object.entries(frequencies).sort(([, left], [, right]) => right - left).slice(0, 40);
  const highestFrequency = words[0]?.[1] || 1;

  if (!words.length) return <p className="text-gray-500">No words with three or more characters yet.</p>;

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-3 rounded border bg-sky-50 p-5">
      {words.map(([word, count]) => (
        <span key={word} style={{ fontSize: `${1 + (count / highestFrequency) * 2}rem` }} className="font-semibold text-sky-900">
          {word}
        </span>
      ))}
    </div>
  );
}