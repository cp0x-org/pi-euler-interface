import { useId } from 'react';
import { Box, Typography, useTheme } from '@mui/material';

import { tokenImageUrl } from '@/api/euler';

import { getArrow, getEnlargedDiagram, getGraphConnectedAddresses, getLabelPosition, type GraphDiagram } from './calculations';

interface DiscoveryGraphProps {
  chainId: number;
  diagram: GraphDiagram;
  selectedAddress: string | null;
  onSelect: (address: string) => void;
}

export function DiscoveryGraph({ chainId, diagram, selectedAddress, onSelect }: DiscoveryGraphProps) {
  const theme = useTheme();
  // Several graphs can be mounted at once and share vault addresses, so clip
  // ids must be unique per instance to avoid cross-graph url(#...) collisions.
  const instanceId = useId().replace(/[^a-zA-Z0-9]/g, '');
  const clipId = (address: string) => `graph-clip-${instanceId}-${address.replace(/[^a-z0-9]/g, '')}`;
  const enlarged = getEnlargedDiagram(diagram);
  const connected = selectedAddress ? getGraphConnectedAddresses(diagram, selectedAddress) : new Set<string>();
  const isNodeHighlighted = (address: string) => !selectedAddress || address === selectedAddress || connected.has(address);
  const isEdgeHighlighted = (from: string, to: string) => !!selectedAddress && (from === selectedAddress || to === selectedAddress);

  return (
    <>
      <Box
        data-testid="discovery-graph"
        onClick={(event) => event.stopPropagation()}
        sx={{ px: 2, pb: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 250 }}
      >
        <svg
          viewBox={`0 0 ${enlarged.viewWidth} ${enlarged.viewHeight}`}
          width={Math.min(enlarged.viewWidth * 1.5, 900)}
          style={{ height: 'auto', maxWidth: '100%', overflow: 'visible' }}
          aria-label={`${diagram.assetCount} asset relationship graph`}
        >
          {enlarged.edges.map((edge) => {
            const highlighted = isEdgeHighlighted(edge.from.address, edge.to.address);
            if (!highlighted) {
              return (
                <line
                  key={`${edge.from.address}:${edge.to.address}`}
                  x1={edge.from.x}
                  y1={edge.from.y}
                  x2={edge.to.x}
                  y2={edge.to.y}
                  stroke={theme.palette.grey[300]}
                  strokeWidth={1.25}
                  strokeLinecap="round"
                  opacity={selectedAddress ? 0.2 : 0.9}
                />
              );
            }

            const arrows = [{ from: edge.from, to: edge.to }, ...(edge.mutual ? [{ from: edge.to, to: edge.from }] : [])];
            return (
              <g key={`${edge.from.address}:${edge.to.address}`}>
                {arrows.map(({ from, to }) => {
                  const arrow = getArrow(from.x, from.y, to.x, to.y, enlarged.nodeRadius);
                  return (
                    <g key={`${from.address}:${to.address}`}>
                      <line
                        x1={from.x}
                        y1={from.y}
                        x2={arrow.lineX2}
                        y2={arrow.lineY2}
                        stroke={theme.palette.secondary.main}
                        strokeWidth={0.8}
                        strokeLinecap="round"
                        opacity={0.95}
                      />
                      <polygon points={arrow.triangle} fill={theme.palette.secondary.main} opacity={0.95} />
                    </g>
                  );
                })}
              </g>
            );
          })}

          {enlarged.nodes.map((node) => {
            const label = getLabelPosition(node, enlarged.centerX, enlarged.centerY);
            const selected = node.address === selectedAddress;
            return (
              <g
                key={node.address}
                role="button"
                tabIndex={0}
                aria-label={`Select ${node.assetSymbol}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect(node.address);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') onSelect(node.address);
                }}
                opacity={isNodeHighlighted(node.address) ? 1 : 0.25}
                style={{ cursor: 'pointer', transition: 'opacity 0.2s' }}
              >
                <circle cx={node.x} cy={node.y} r={enlarged.nodeRadius + 6} fill="transparent" pointerEvents="all" />
                <clipPath id={clipId(node.address)}>
                  <circle cx={node.x} cy={node.y} r={enlarged.nodeRadius} />
                </clipPath>
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={selected ? enlarged.nodeRadius + 1 : enlarged.nodeRadius}
                  pointerEvents="none"
                  fill={theme.palette.background.paper}
                  stroke={selected ? theme.palette.secondary.main : theme.palette.grey[500]}
                  strokeWidth={selected ? 2 : 1}
                />
                <text
                  x={node.x}
                  y={node.y + 3.5}
                  pointerEvents="none"
                  textAnchor="middle"
                  fill={theme.palette.text.secondary}
                  fontSize={7}
                  fontWeight={700}
                >
                  {node.assetSymbol.slice(0, 2).toUpperCase()}
                </text>
                <image
                  x={node.x - enlarged.nodeRadius}
                  y={node.y - enlarged.nodeRadius}
                  width={enlarged.nodeRadius * 2}
                  height={enlarged.nodeRadius * 2}
                  pointerEvents="none"
                  href={tokenImageUrl(chainId, node.assetAddress)}
                  clipPath={`url(#${clipId(node.address)})`}
                />
                <text
                  x={label.x}
                  y={label.y}
                  pointerEvents="none"
                  textAnchor={label.anchor}
                  fill={node.external ? theme.palette.text.disabled : theme.palette.text.primary}
                  fontSize={12}
                  fontWeight={500}
                >
                  {node.assetSymbol}
                </text>
              </g>
            );
          })}
        </svg>
      </Box>
      {!selectedAddress && (
        <Typography variant="body2" sx={{ textAlign: 'center', px: 2, pb: 1.5 }}>
          Select a node to highlight connections and see lending/borrowing options below.
        </Typography>
      )}
    </>
  );
}
