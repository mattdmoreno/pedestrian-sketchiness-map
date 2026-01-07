import './globals.css';

export const metadata = {
  title: 'San Antonio Crosswalk Accessibility Map',
  description: 'San Antonio basemap + overlays from PMTiles',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Overpass:wght@700;800;900&display=swap"
        />
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css"
        />
        {/* Open Graph / Facebook */}
        <meta property="og:type" content="website" />
        <meta property="og:title" content="San Antonio Crosswalk Accessibility Map" />
        <meta property="og:description" content="Explore San Antonio's best and sketchiest pedestrian infrastructure." />
        <meta property="og:image" content="/image.jpg" />
        <meta property="og:url" content="https://michaelthoreau.github.io/pedestrian-sketchiness-map/" />

        {/* Twitter */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="San Antonio Crosswalk Accessibility Map" />
        <meta name="twitter:description" content="San Antonio Seattle's best and sketchiest pedestrian infrastructure." />
        <meta name="twitter:image" content="/image.jpg" />

      </head>
      <body>{children}</body>
    </html>
  );
}
