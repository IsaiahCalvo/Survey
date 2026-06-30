import React from 'react';
import Svg, { Circle as SvgCircle, G, Line, Rect, Text as SvgText } from 'react-native-svg';
import type { Marker, InkMark } from '../../types';
import { entities } from '../../data/surveyData';

function TextSvg({ x, y, value }: { x: number; y: number; value: string }) {
  return (
    <SvgText x={x} y={y} fill="#68707A" fontSize={4.5} fontWeight="800">
      {value}
    </SvgText>
  );
}

export function MiniPagePreview({ page, markers, inkMarks }: { page: number; markers: Marker[]; inkMarks: InkMark[] }) {
  return (
    <Svg width="100%" height="100%" viewBox="0 0 92 112">
      <Rect x={0} y={0} width={92} height={112} fill="#FAFAF8" />
      {page === 1 ? (
        <>
          <Rect x={15} y={18} width={62} height={64} fill="none" stroke="#303640" strokeWidth={1.6} />
          <Line x1={39} y1={18} x2={39} y2={53} stroke="#303640" strokeWidth={1.6} />
          <Line x1={15} y1={53} x2={77} y2={53} stroke="#303640" strokeWidth={1.6} />
          <Line x1={58} y1={53} x2={58} y2={82} stroke="#303640" strokeWidth={1.6} />
          <Rect x={20} y={24} width={42} height={33} fill="rgba(74,144,226,0.16)" stroke="#4A90E2" strokeWidth={1.2} />
          <TextSvg x={24} y={33} value="LOBBY" />
          <TextSvg x={52} y={37} value="OFFICE" />
          <TextSvg x={26} y={70} value="RETAIL" />
          <TextSvg x={64} y={70} value="IDF" />
          {inkMarks.map((mark) => (
            <SvgCircle key={mark.id} cx={mark.x * 92} cy={mark.y * 112} r={1.9} fill="#DC3545" />
          ))}
          {markers.map((marker) => {
            const entity = entities.find((item) => item.id === marker.entity);
            return (
              <G key={marker.id}>
                <SvgCircle cx={marker.x * 92} cy={marker.y * 112} r={4.4} fill={entity?.color ?? '#FFF5C3'} stroke="#303640" strokeWidth={0.9} />
              </G>
            );
          })}
        </>
      ) : (
        <>
          <Rect x={18} y={22} width={56} height={68} fill="none" stroke="#303640" strokeWidth={1.4} />
          <Line x1={18} y1={49} x2={74} y2={49} stroke="#303640" strokeWidth={1.4} />
          <Line x1={47} y1={22} x2={47} y2={90} stroke="#303640" strokeWidth={1.4} />
          <TextSvg x={25} y={38} value="FLOOR 2" />
        </>
      )}
    </Svg>
  );
}
