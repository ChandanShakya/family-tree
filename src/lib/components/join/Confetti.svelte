<!-- CSS-only confetti on join/claim (§7.5). Hidden entirely under prefers-reduced-motion. -->
<div class="confetti" aria-hidden="true">
	{#each Array.from({ length: 24 }, (_, i) => i) as i (i)}
		<span style="--x:{(i * 37) % 100}%; --d:{(i % 6) * 0.15}s; --c:{['#047857', '#6d28d9', '#b45309', '#b91c1c'][i % 4]}"></span>
	{/each}
</div>

<style>
	.confetti {
		pointer-events: none;
		position: fixed;
		inset: 0;
		overflow: hidden;
		z-index: 60;
	}
	span {
		position: absolute;
		top: -12px;
		left: var(--x);
		width: 8px;
		height: 14px;
		background: var(--c);
		animation: fall 1.8s ease-in var(--d) forwards;
	}
	@keyframes fall {
		to {
			transform: translateY(105vh) rotate(540deg);
			opacity: 0.2;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.confetti {
			display: none;
		}
	}
</style>
