import GameLoader from "@/components/GameLoader";

// O'yin dvigateli body'ning to'g'ridan-to'g'ri bolalarini boshqaradi,
// shuning uchun canvas o'rovchi element ichiga olinmaydi.
export default function Home() {
  return (
    <>
      <canvas id="canvasA" width={128} height={128} />
      <GameLoader />
    </>
  );
}
