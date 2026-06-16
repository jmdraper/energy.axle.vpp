'use strict';

function onHomeyReady(Homey) {
  const tokenInput = document.getElementById('token');
  const btnTest    = document.getElementById('btnTest');
  const btnNext    = document.getElementById('btnNext');
  const status     = document.getElementById('status');

  function setStatus(msg, type) {
    status.textContent = msg;
    status.className = type || '';
  }

  function setValidated(ok) {
    btnNext.disabled = !ok;
  }

  setStatus('Ready — enter token and test.', 'info');

  tokenInput.addEventListener('input', () => setValidated(false));

  btnTest.addEventListener('click', async () => {
    const token = tokenInput.value.trim();
    if (!token) {
      setStatus('Please enter your API token.', 'error');
      return;
    }

    btnTest.disabled = true;
    setStatus('Testing connection…', 'info');

    try {
      await Homey.emit('validate', { token });
      setStatus('Connection successful!', 'success');
      setValidated(true);
    } catch (err) {
      const msg = (err && err.message) ? err.message : String(err);
      if (msg.includes('UNAUTHORIZED') || msg.includes('401')) {
        setStatus('Invalid API token. Please check and try again.', 'error');
      } else {
        setStatus('Connection failed: ' + msg, 'error');
      }
      setValidated(false);
    } finally {
      btnTest.disabled = false;
    }
  });

  btnNext.addEventListener('click', async () => {
    await Homey.nextView();
  });

  tokenInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') btnTest.click();
  });

  Homey.ready();
}
