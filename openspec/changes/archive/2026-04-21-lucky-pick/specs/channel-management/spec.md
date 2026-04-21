## ADDED Requirements

### Requirement: Channels page
The system SHALL provide a `/channels` page listing all YouTube channel sources and their channels.

#### Scenario: View existing channels
- **WHEN** the user navigates to `/channels`
- **THEN** the page SHALL display all YouTube channels grouped by category, showing each channel's name

### Requirement: Add channel form
The `/channels` page SHALL include a form to add a new YouTube channel.

#### Scenario: Add channel by URL
- **WHEN** the user enters a YouTube channel URL (e.g., `https://www.youtube.com/@handle` or `https://www.youtube.com/channel/UCxxx`) and selects a category
- **THEN** the system SHALL resolve the channel ID, validate the RSS feed works, and add the channel to the appropriate user source

#### Scenario: Add channel by ID
- **WHEN** the user enters a raw channel ID (e.g., `UCxxx`) and selects a category
- **THEN** the system SHALL validate the RSS feed works and add the channel

#### Scenario: Invalid channel
- **WHEN** the user enters a URL or ID that does not resolve to a valid YouTube channel RSS feed
- **THEN** the system SHALL display an error message and not add the channel

#### Scenario: Duplicate channel
- **WHEN** the user tries to add a channel that already exists in any source
- **THEN** the system SHALL display a message indicating the channel is already added

### Requirement: Remove channel
The `/channels` page SHALL allow removing individual user-added channels.

#### Scenario: Remove a user-added channel
- **WHEN** the user clicks "Remove" on a user-added channel
- **THEN** the channel SHALL be removed from its source config

### Requirement: Channel storage in sources table
User-added channels SHALL be stored in the existing `sources` table using source IDs of the form `youtube_{category}_user`.

#### Scenario: First user channel in a category
- **WHEN** the user adds their first channel in the "culture" category
- **THEN** a new source row SHALL be created with `id = 'youtube_culture_user'`, `kind = 'youtube_channel'`, and the channel in the config's `channels` array

#### Scenario: Subsequent channel in same category
- **WHEN** the user adds another channel in the "culture" category
- **THEN** the channel SHALL be appended to the existing `youtube_culture_user` source's config `channels` array

### Requirement: Fetcher integration
User-added channel sources SHALL be picked up by the existing YouTube channel fetcher via the fetcher registry without code changes to the fetcher.

#### Scenario: Fetcher runs with user channels
- **WHEN** the orchestrator runs and a `youtube_{category}_user` source exists
- **THEN** the YouTube channel fetcher SHALL fetch RSS feeds for those channels and upsert events
