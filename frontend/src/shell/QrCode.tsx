import { encode } from 'uqr'

/** A QR code of the text, drawn as one path so it stays sharp at any size. */
export function QrCode(props: { text: string; label: string }) {
  const qr = () => encode(props.text, { ecc: 'M', border: 2 })
  const path = () =>
    qr()
      .data.flatMap((row, y) => row.flatMap((dark, x) => (dark ? [`M${x} ${y}h1v1h-1z`] : [])))
      .join('')
  return (
    <svg
      class="qr-code"
      role="img"
      aria-label={props.label}
      viewBox={`0 0 ${qr().size} ${qr().size}`}
      shape-rendering="crispEdges"
    >
      {/* Black on white in every theme: phones read a QR code reliably only that way round. */}
      <rect width={qr().size} height={qr().size} fill="white" />
      <path d={path()} fill="black" />
    </svg>
  )
}
