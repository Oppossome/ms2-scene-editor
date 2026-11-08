<script lang="ts">
  import '../app.css';
  import { page } from '$app/state';

  let { children } = $props();

  const links = [
    { href: '/dresser', label: 'Dresser' },
    { href: '/scene', label: 'Scene' },
    { href: '/maps', label: 'Maps' },
    { href: '/models', label: 'Models' }
  ];
</script>

<nav>
  <a class="brand" href="/">BannedStory2</a>
  {#each links as link}
    <a href={link.href} class:active={page.url.pathname.startsWith(link.href)}>{link.label}</a>
  {/each}
</nav>

<main>
  {@render children()}
</main>

<style>
  nav {
    display: flex;
    gap: 1rem;
    align-items: center;
    padding: 0 1rem;
    height: 44px;
    background: #1b1d26;
    border-bottom: 1px solid #2c2f3d;
  }
  nav a {
    color: #b9bdd0;
    text-decoration: none;
    font-size: 14px;
  }
  nav a.active,
  nav a:hover {
    color: #fff;
  }
  .brand {
    font-weight: 700;
    color: #fff;
    margin-right: 1rem;
  }
  main {
    height: calc(100vh - 45px);
    overflow: hidden;
  }
</style>
