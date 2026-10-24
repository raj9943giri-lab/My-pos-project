import Link from 'next/link';

/**
 * / — बिना slug का root. दुकान का लिंक हमेशा /s/<slug> होता है (Part-2 WhatsApp
 * share वही बनाता है), इसलिए यहाँ साफ़ मार्गदर्शन दिखाते हैं.
 */
export default function Root() {
  return (
    <main className="wrap wrap-sm">
      <div className="card" style={{ marginTop: 40 }}>
        <h2>नमस्ते 👋</h2>
        <p>यह SOS Local Dukaan का कस्टमर स्टोर है. दुकानदार से मिले लिंक से सीधे दुकान खुलेगी:</p>
        <p style={{ background: '#f4f7f6', borderRadius: 10, padding: '8px 10px', fontSize: 14 }}>
          <code>…/s/राजेश-किराना</code>&nbsp;
          <span style={{ color: '#5b6b77' }}>— slug वाला पूरा लिंक</span>
        </p>
        <Link href="/" style={{ fontWeight: 700 }}>↺ फिर से लिंक खोलें</Link>
      </div>
      <p className="blue">दुकान का लिंक (WhatsApp/शेयर) से ही खुलता है — यह साइट दुकानें खुद नहीं गिनती.</p>
    </main>
  );
}
