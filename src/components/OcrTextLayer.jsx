export default function OcrTextLayer({ words = [], pageSize }) {
  if (!pageSize?.width || !pageSize?.height || words.length === 0) return null;
  return (
    <div className="pdfjsTextLayer is-interactive" data-ocr-text-layer="true" style={{ width: '100%', height: '100%' }}>
      {words.map((word, index) => {
        const q = word.quad;
        const left = Math.min(q.x1, q.x2, q.x3, q.x4);
        const top = Math.min(q.y1, q.y2, q.y3, q.y4);
        const right = Math.max(q.x1, q.x2, q.x3, q.x4);
        const bottom = Math.max(q.y1, q.y2, q.y3, q.y4);
        return (
          <span
            key={`${left}:${top}:${index}`}
            data-ocr-confidence={word.confidence}
            style={{
              left: `${left / pageSize.width * 100}%`,
              top: `${top / pageSize.height * 100}%`,
              width: `${(right - left) / pageSize.width * 100}%`,
              height: `${(bottom - top) / pageSize.height * 100}%`,
              fontSize: `${Math.max(1, bottom - top)}px`,
              lineHeight: 1,
              transform: 'none',
            }}
          >{`${word.text} `}</span>
        );
      })}
    </div>
  );
}
