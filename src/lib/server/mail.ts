import { env } from '$env/dynamic/private';

export interface MailMessage {
	to: string;
	subject: string;
	text: string;
}

// Returns the reset/verification link when SMTP is unset (§6.1); null otherwise.
// Never throws: callers fire and forget, and an SMTP outage must not crash the process or reveal
// (through a 500 or a slower response) whether an account exists.
export async function sendMail(msg: MailMessage): Promise<string | null> {
	// `||`, not `??`: docker compose passes unset optional variables as empty strings.
	const host = env.SMTP_HOST || '';
	if (!host) {
		console.log(`[mail] SMTP unset; to=${msg.to} subject=${msg.subject} body=${msg.text}`);
		return msg.text;
	}
	const port = Number(env.SMTP_PORT) || 587;
	const user = env.SMTP_USER || '';
	try {
		// Loaded on first use: nodemailer costs ~25 MB resident and most installs never send mail.
		const { default: nodemailer } = await import('nodemailer');
		const transport = nodemailer.createTransport({
			host,
			port,
			secure: port === 465,
			requireTLS: port !== 465, // STARTTLS on 587; refuse to send credentials in clear text
			auth: user ? { user, pass: env.SMTP_PASS || '' } : undefined
		});
		await transport.sendMail({ from: env.SMTP_FROM || user, to: msg.to, subject: msg.subject, text: msg.text });
	} catch (e) {
		console.error(`[mail] send failed; subject=${msg.subject}: ${(e as Error).message}`);
	}
	return null;
}
